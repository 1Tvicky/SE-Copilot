import { NextResponse } from "next/server";
import { prisma, recordApprovalEvent } from "@meeting-assistant/db";
import { momRejectSchema } from "@meeting-assistant/shared";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const parsed = momRejectSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);

  const mom = await prisma.mom.findUnique({ where: { meetingSessionId: id } });
  if (!mom) return jsonError(404, "No MOM has been generated for this meeting yet.");
  if (mom.status === "SENT") return jsonError(409, "This MOM was already sent.");

  const rejected = await prisma.$transaction(async (tx) => {
    const m = await tx.mom.update({
      where: { id: mom.id },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: ctx.user.id,
        rejectionReason: parsed.data.reason,
        approvedHash: null,
        approvedAt: null,
        approvedById: null,
      },
    });
    await tx.emailMessage.updateMany({ where: { momId: mom.id, status: "DRAFT" }, data: { status: "CANCELLED" } });
    await recordApprovalEvent(tx, {
      contentType: "MOM",
      contentId: mom.id,
      meetingSessionId: id,
      action: "REJECTED",
      actorUserId: ctx.user.id,
      metadata: { reason: parsed.data.reason },
    });
    return m;
  });
  return NextResponse.json(rejected);
}
