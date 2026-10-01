import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { buildJobId, QUEUE_NAMES } from "@meeting-assistant/shared";
import { jsonError, requireApiContext, requireManageableMeeting } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

/** Generate (or regenerate) the analysis + MOM from whatever transcript/notes exist. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;
  if (meeting.status === "CANCELLED") return jsonError(409, "This meeting was cancelled.");

  const [transcripts, notes, mom] = await Promise.all([
    prisma.transcript.count({ where: { meetingSessionId: id, status: "READY" } }),
    prisma.meetingNote.count({ where: { meetingSessionId: id } }),
    prisma.mom.findUnique({ where: { meetingSessionId: id }, select: { status: true } }),
  ]);
  if (transcripts === 0 && notes === 0) {
    return jsonError(409, "There is no transcript or note to analyze yet. Add notes or upload a transcript first.");
  }
  if (mom?.status === "SENT") {
    return jsonError(409, "This MOM was already sent to the customer, so it can no longer be regenerated.");
  }

  const jobId = await enqueue(
    QUEUE_NAMES.meetingAnalysis,
    { meetingSessionId: id, reason: mom ? "regenerate" : "manual", requestedById: ctx.user.id },
    { singletonKey: buildJobId("analysis", id) },
  );
  await recordAuditEvent({ actorUserId: ctx.user.id, action: "meeting.analysis_requested", targetType: "MeetingSession", targetId: id });
  return NextResponse.json({ queued: true, alreadyQueued: jobId === null }, { status: 202 });
}
