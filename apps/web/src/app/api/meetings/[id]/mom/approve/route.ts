import { NextResponse } from "next/server";
import { prisma, contentHash, recordApprovalEvent } from "@meeting-assistant/db";
import { jsonError, requireApiContext, requireManageableMeeting } from "@/lib/api";

/** SE approval of the customer-facing MOM. Pins the exact content via a hash. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const mom = await prisma.mom.findUnique({ where: { meetingSessionId: id } });
  if (!mom) return jsonError(404, "No MOM has been generated for this meeting yet.");
  if (mom.status === "SENT") return jsonError(409, "This MOM was already sent.");
  if (mom.status === "APPROVED") return NextResponse.json(mom);
  if (mom.status === "REJECTED") return jsonError(409, "This MOM was rejected. Edit or regenerate it before approving.");

  const hash = contentHash(mom.markdown);
  const approved = await prisma.$transaction(async (tx) => {
    const m = await tx.mom.update({
      where: { id: mom.id },
      data: { status: "APPROVED", approvedHash: hash, approvedAt: new Date(), approvedById: ctx.user.id },
    });
    await recordApprovalEvent(tx, {
      contentType: "MOM",
      contentId: mom.id,
      meetingSessionId: id,
      action: "APPROVED",
      actorUserId: ctx.user.id,
      snapshot: mom.markdown,
      metadata: { hash, version: mom.version, editedFromAi: mom.markdown !== mom.aiMarkdown },
    });
    return m;
  });
  return NextResponse.json(approved);
}
