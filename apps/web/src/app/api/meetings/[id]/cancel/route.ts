import { NextResponse } from "next/server";
import { prisma, applyMeetingTransition, refreshBotEligibility } from "@meeting-assistant/db";
import { buildJobId, QUEUE_NAMES } from "@meeting-assistant/shared";
import { jsonError, requireApiContext, requireManageableMeeting } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const result = await applyMeetingTransition(prisma, {
    meetingSessionId: id,
    toStatus: "CANCELLED",
    source: "USER",
    message: `Cancelled in SE Copilot by ${ctx.user.name}`,
    extraData: { cancelledAt: new Date() },
  });
  if (!result.ok) return jsonError(409, result.reason);
  if (result.idempotentNoop) return NextResponse.json({ message: "Already cancelled" });

  await refreshBotEligibility(prisma, id, { isCancelled: true });
  // The reconcile job sees the cancelled status and withdraws any scheduled notetaker.
  await enqueue(QUEUE_NAMES.botSchedule, { meetingSessionId: id }, { singletonKey: buildJobId("bot", id) }).catch((err) =>
    console.error("Failed to enqueue bot cancel", { id, err }),
  );
  await recordAuditEvent({ actorUserId: ctx.user.id, action: "meeting.cancelled", targetType: "MeetingSession", targetId: id });
  return NextResponse.json({ message: "Cancelled" });
}
