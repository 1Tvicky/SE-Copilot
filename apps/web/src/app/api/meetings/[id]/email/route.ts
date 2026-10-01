import { NextResponse } from "next/server";
import { prisma, contentHash, recordApprovalEvent, validateStoredEmail, type Prisma } from "@meeting-assistant/db";
import { buildFollowUpEmail, emailDraftSchema } from "@meeting-assistant/shared";
import { findVisibleMeeting } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";

type RouteParams = { params: Promise<{ id: string }> };

async function latestEmail(meetingSessionId: string) {
  return prisma.emailMessage.findFirst({
    where: { meetingSessionId, kind: "CUSTOMER_MOM", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
  });
}

/** The current follow-up email (draft or sent) plus a freshly computed validation. */
export async function GET(_request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await findVisibleMeeting(ctx, id);
  if (!meeting) return jsonError(404, "Not found");
  const email = await latestEmail(id);
  if (!email) return NextResponse.json({ email: null, validation: null });
  return NextResponse.json({ email, validation: await validateStoredEmail(prisma, email.id) });
}

/**
 * Prepares the customer follow-up from the APPROVED MOM. Defaults: customer
 * participants on To, internal participants on Cc, the configured Team DL as
 * sender, and "Re: <original subject>".
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const full = await prisma.meetingSession.findUniqueOrThrow({
    where: { id },
    include: { team: true, mom: true, participants: true },
  });
  const mom = full.mom;
  if (!mom) return jsonError(404, "No MOM has been generated for this meeting yet.");
  if (mom.status !== "APPROVED") return jsonError(409, "Approve the MOM before preparing the customer email.");
  const team = full.team;
  if (!team?.teamDlAddress || !team.senderMailbox) {
    return jsonError(409, "The Team DL and sending mailbox are not configured. An admin can set them in Settings → Team.");
  }

  const external = full.participants.filter((p) => p.isExternal);
  const internal = full.participants.filter(
    (p) => !p.isExternal && p.email !== team.teamDlAddress?.toLowerCase() && p.email !== team.senderMailbox?.toLowerCase(),
  );
  const signatureName = team.teamDlDisplayName ?? team.name;
  const body = buildFollowUpEmail({ originalSubject: full.name, momMarkdown: mom.markdown, signatureName, signature: team.emailSignature });

  const email = await prisma.$transaction(async (tx) => {
    await tx.emailMessage.updateMany({ where: { momId: mom.id, status: "DRAFT" }, data: { status: "CANCELLED" } });
    const e = await tx.emailMessage.create({
      data: {
        teamId: team.id,
        meetingSessionId: id,
        momId: mom.id,
        kind: "CUSTOMER_MOM",
        status: "DRAFT",
        fromAddress: team.teamDlAddress!,
        fromName: signatureName,
        senderMailbox: team.senderMailbox!,
        toJson: external.map((p) => ({ address: p.email, name: p.name })) as Prisma.InputJsonValue,
        ccJson: internal.map((p) => ({ address: p.email, name: p.name })) as Prisma.InputJsonValue,
        subject: body.subject,
        bodyHtml: body.html,
        bodyText: body.text,
        momHash: contentHash(mom.markdown),
      },
    });
    await recordApprovalEvent(tx, {
      contentType: "CUSTOMER_EMAIL",
      contentId: e.id,
      meetingSessionId: id,
      action: "EMAIL_PREPARED",
      actorUserId: ctx.user.id,
      snapshot: body.text,
      metadata: { from: e.fromAddress, to: external.map((p) => p.email), cc: internal.map((p) => p.email) },
    });
    return e;
  });

  const validation = await validateStoredEmail(prisma, email.id);
  await prisma.emailMessage.update({ where: { id: email.id }, data: { validationJson: validation as unknown as Prisma.InputJsonValue } });
  return NextResponse.json({ email, validation }, { status: 201 });
}

/** Edit recipients / subject of the draft. The body is always the approved MOM. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const parsed = emailDraftSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const email = await latestEmail(id);
  if (!email || email.status !== "DRAFT") return jsonError(409, "There is no draft email to edit. Prepare one from the approved MOM.");

  await prisma.emailMessage.update({
    where: { id: email.id },
    data: {
      toJson: parsed.data.to as Prisma.InputJsonValue,
      ccJson: parsed.data.cc as Prisma.InputJsonValue,
      subject: parsed.data.subject,
    },
  });
  const validation = await validateStoredEmail(prisma, email.id);
  const updated = await prisma.emailMessage.update({
    where: { id: email.id },
    data: { validationJson: validation as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ email: updated, validation });
}
