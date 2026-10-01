import { prisma, applyMeetingTransition, enqueueJob } from "@meeting-assistant/db";
import { buildJobId, QUEUE_NAMES, type CaptureTimeoutJobData } from "@meeting-assistant/shared";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";
import { notify } from "../notify.js";
import { CAPTURE_TIMEOUT_GRACE_MINUTES } from "./bot-schedule.js";

const AWAITING_CAPTURE = ["SCHEDULED", "PREPARING", "JOINING", "WAITING_FOR_ADMISSION", "ACTIVE", "RECORDING"] as const;

/**
 * Safety net for meetings with a scheduled notetaker: if no status webhook
 * ever ends capture (meeting ran long, webhooks misconfigured, provider
 * outage), mark it "capture unavailable" instead of leaving it in limbo.
 * Self-reschedules if the meeting was moved later in the meantime.
 */
export async function processCaptureTimeout(job: JobContext<CaptureTimeoutJobData>): Promise<void> {
  const meeting = await prisma.meetingSession.findUnique({
    where: { id: job.data.meetingSessionId },
    include: { botSessions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!meeting || !(AWAITING_CAPTURE as readonly string[]).includes(meeting.status)) return;
  if (meeting.botSessions.length === 0) return;

  const endsAt = meeting.endsAt ?? new Date(meeting.scheduledAt.getTime() + meeting.maxDurationMinutes * 60_000);
  const deadline = new Date(endsAt.getTime() + CAPTURE_TIMEOUT_GRACE_MINUTES * 60_000);
  if (deadline > new Date()) {
    await enqueueJob(QUEUE_NAMES.captureTimeout, { meetingSessionId: meeting.id }, { singletonKey: buildJobId("capture-timeout-r", meeting.id, deadline.getTime()), startAfter: deadline });
    return;
  }

  const reason = "No transcript was received from the notetaker.";
  const result = await applyMeetingTransition(prisma, {
    meetingSessionId: meeting.id,
    toStatus: "FAILED",
    source: "SYSTEM",
    message: `Meeting capture unavailable: ${reason}`,
    idempotencyKey: `capture-timeout:${meeting.id}:${deadline.getTime()}`,
    extraData: { failureReason: `Meeting capture unavailable: ${reason}` },
  });
  if (result.ok && !result.idempotentNoop) {
    logger.warn({ meetingSessionId: meeting.id }, "Capture timed out");
    void notify(meeting.id, "BOT_FAILED", `Meeting capture unavailable: ${reason} Upload/paste a transcript or add notes to generate the MOM.`);
  }
}
