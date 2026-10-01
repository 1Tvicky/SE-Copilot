import { NextResponse } from "next/server";
import { prisma, contentHash, recordApprovalEvent } from "@meeting-assistant/db";
import { momUpdateSchema } from "@meeting-assistant/shared";
import { findVisibleMeeting } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await findVisibleMeeting(ctx, id, { mom: true });
  if (!meeting?.mom) return jsonError(404, "No MOM has been generated for this meeting yet.");
  return NextResponse.json(meeting.mom);
}

/**
 * SE edits the MOM. Any edit after approval revokes the approval: what gets
 * sent must be exactly what was approved.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const parsed = momUpdateSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);

  const mom = await prisma.mom.findUnique({ where: { meetingSessionId: id } });
  if (!mom) return jsonError(404, "No MOM has been generated for this meeting yet.");
  if (mom.status === "SENT") return jsonError(409, "This MOM was already sent to the customer and can no longer be edited.");
  if (mom.markdown === parsed.data.markdown) return NextResponse.json(mom);

  const updated = await prisma.$transaction(async (tx) => {
    const m = await tx.mom.update({
      where: { id: mom.id },
      data: {
        markdown: parsed.data.markdown,
        editedAt: new Date(),
        editedById: ctx.user.id,
        status: "AWAITING_APPROVAL",
        approvedHash: null,
        approvedAt: null,
        approvedById: null,
      },
    });
    // Drafts rendered from the old content are void.
    await tx.emailMessage.updateMany({ where: { momId: mom.id, status: "DRAFT" }, data: { status: "CANCELLED" } });
    await recordApprovalEvent(tx, {
      contentType: "MOM",
      contentId: mom.id,
      meetingSessionId: id,
      action: "EDITED",
      actorUserId: ctx.user.id,
      snapshot: parsed.data.markdown,
      metadata: { previousStatus: mom.status, hash: contentHash(parsed.data.markdown) },
    });
    return m;
  });
  return NextResponse.json(updated);
}
