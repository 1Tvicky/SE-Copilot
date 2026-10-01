import { NextResponse } from "next/server";
import { prisma, recordApprovalEvent, validateStoredEmail, type Prisma } from "@meeting-assistant/db";
import { emailConfirmSchema, QUEUE_NAMES } from "@meeting-assistant/shared";
import { clientIp, invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The SE's explicit "Send" on the final preview. Re-validates server-side
 * (the preview the SE looked at may be stale), requires warnings to have been
 * acknowledged, then hands the email to the worker.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const limit = await rateLimit(`email-confirm:${ctx.user.id}`, 20, 60 * 60);
  if (!limit.allowed) return jsonError(429, "Too many send attempts. Try again later.");

  const parsed = emailConfirmSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);

  const email = await prisma.emailMessage.findFirst({
    where: { meetingSessionId: id, kind: "CUSTOMER_MOM", status: "DRAFT" },
    orderBy: { createdAt: "desc" },
  });
  if (!email) return jsonError(409, "There is no draft email awaiting confirmation.");

  const validation = await validateStoredEmail(prisma, email.id);
  if (!validation) return jsonError(409, "This email is no longer linked to a MOM.");
  if (!validation.ok) return jsonError(409, "The email failed validation.", validation);
  if (validation.issues.length > 0 && !parsed.data.acknowledgedWarnings) {
    return jsonError(409, "Review and acknowledge the warnings before sending.", validation);
  }

  // Guarded transition: only a DRAFT can be queued, exactly once.
  const queued = await prisma.$transaction(async (tx) => {
    const res = await tx.emailMessage.updateMany({
      where: { id: email.id, status: "DRAFT" },
      data: {
        status: "QUEUED",
        confirmedAt: new Date(),
        confirmedById: ctx.user.id,
        validationJson: validation as unknown as Prisma.InputJsonValue,
      },
    });
    if (res.count === 0) return false;
    await recordApprovalEvent(tx, {
      contentType: "CUSTOMER_EMAIL",
      contentId: email.id,
      meetingSessionId: id,
      action: "SEND_CONFIRMED",
      actorUserId: ctx.user.id,
      snapshot: email.bodyText,
      metadata: { from: email.fromAddress, to: email.toJson, cc: email.ccJson, subject: email.subject, warnings: validation.issues.length },
    });
    return true;
  });
  if (!queued) return jsonError(409, "This email was already confirmed.");

  try {
    await enqueue(QUEUE_NAMES.emailSend, { emailMessageId: email.id });
  } catch (err) {
    // Roll back to DRAFT so the SE can try again; nothing was sent.
    await prisma.emailMessage.update({ where: { id: email.id }, data: { status: "DRAFT", confirmedAt: null, confirmedById: null } });
    console.error("Failed to enqueue email send", { emailId: email.id, err });
    return jsonError(503, "Could not queue the email for sending. Nothing was sent; please try again.");
  }

  await recordAuditEvent({
    actorUserId: ctx.user.id,
    action: "customer_email.send_confirmed",
    targetType: "EmailMessage",
    targetId: email.id,
    ipAddress: clientIp(request),
  });
  return NextResponse.json({ status: "QUEUED" }, { status: 202 });
}
