import { prisma, applyMeetingTransition, enqueueJob } from "@meeting-assistant/db";
import { buildJobId, QUEUE_NAMES, type ZoomWebhookJobData } from "@meeting-assistant/shared";
import { zoomMeetingObjectSchema, zoomRecordingObjectSchema } from "../zoom/webhook-schema.js";
import { findMeetingSessionForZoomObject } from "../zoom/find-meeting-session.js";
import { logger, type Log } from "../logger.js";
import type { JobContext } from "../jobs.js";
import { notify } from "../notify.js";

const RECORDING_FILE_TYPE_MAP: Record<string, "VIDEO" | "AUDIO" | "CHAT" | "TRANSCRIPT_VTT"> = {
  MP4: "VIDEO",
  M4A: "AUDIO",
  CHAT: "CHAT",
  TRANSCRIPT: "TRANSCRIPT_VTT",
};

/**
 * Zoom cloud-recording webhooks: the fallback capture path for meetings
 * hosted in the organization's own Zoom account. When the AI notetaker is
 * capturing the same meeting, its transcript is the primary source and the
 * cloud recording is not transcribed again.
 */
export async function processZoomWebhookEvent(job: JobContext<ZoomWebhookJobData>): Promise<void> {
  const { eventType, eventTs, payload } = job.data;
  const log = logger.child({ eventType, jobId: job.id });

  switch (eventType) {
    case "meeting.started":
      await handleMeetingStarted(payload, eventTs, log);
      return;
    case "meeting.ended":
      await handleMeetingEnded(payload, eventTs, log);
      return;
    case "recording.completed":
      await handleRecordingCompleted(payload, log);
      return;
    default:
      log.info("Ignoring unhandled Zoom event type");
  }
}

async function handleMeetingStarted(
  payload: Record<string, unknown>,
  eventTs: number,
  log: Log,
) {
  const object = zoomMeetingObjectSchema.parse(payload.object);
  const meetingId = String(object.id);
  const meeting = await findMeetingSessionForZoomObject(prisma, { meetingId, uuid: object.uuid });
  if (!meeting) {
    log.warn({ meetingId }, "No matching MeetingSession for meeting.started");
    return;
  }

  const result = await applyMeetingTransition(prisma, {
    meetingSessionId: meeting.id,
    toStatus: "ACTIVE",
    source: "WEBHOOK",
    message: "Zoom reported the meeting started",
    idempotencyKey: `meeting.started:${object.uuid ?? meetingId}`,
    extraData: {
      startedAt: new Date(eventTs),
      ...(object.uuid ? { externalMeetingUuid: object.uuid } : {}),
    },
  });
  if (!result.ok) {
    log.warn({ meetingId: meeting.id, reason: result.reason }, "Could not apply meeting.started transition");
  } else if (!result.idempotentNoop) {
    void notify(meeting.id, "JOIN_SUCCEEDED", "Zoom reported that your meeting is now active.");
  }
}

async function handleMeetingEnded(
  payload: Record<string, unknown>,
  eventTs: number,
  log: Log,
) {
  const object = zoomMeetingObjectSchema.parse(payload.object);
  const meetingId = String(object.id);
  const meeting = await findMeetingSessionForZoomObject(prisma, { meetingId, uuid: object.uuid });
  if (!meeting) {
    log.warn({ meetingId }, "No matching MeetingSession for meeting.ended");
    return;
  }

  const result = await applyMeetingTransition(prisma, {
    meetingSessionId: meeting.id,
    toStatus: "PROCESSING",
    source: "WEBHOOK",
    message: "Zoom reported the meeting ended; awaiting recording if requested",
    idempotencyKey: `meeting.ended:${object.uuid ?? meetingId}`,
    extraData: { endedAt: new Date(eventTs) },
  });
  if (!result.ok) {
    log.warn({ meetingId: meeting.id, reason: result.reason }, "Could not apply meeting.ended transition");
    return;
  }

  // No recording was requested at all — nothing else will ever move this
  // session forward, so finalize it now instead of leaving it stuck in
  // PROCESSING forever.
  if (meeting.recordingPreference === "NONE") {
    const finalize = await applyMeetingTransition(prisma, {
      meetingSessionId: meeting.id,
      toStatus: "COMPLETED",
      source: "SYSTEM",
      message: "No recording was requested for this session",
      idempotencyKey: `finalize-no-recording:${meeting.id}`,
    });
    if (finalize.ok && !finalize.idempotentNoop) {
      void notify(meeting.id, "MEETING_COMPLETED", "Your meeting has completed.");
    }
  }
}

async function handleRecordingCompleted(payload: Record<string, unknown>, log: Log) {
  const object = zoomRecordingObjectSchema.parse(payload.object);
  const meetingId = String(object.id);
  const meeting = await findMeetingSessionForZoomObject(prisma, { meetingId, uuid: object.uuid });
  if (!meeting) {
    log.warn({ meetingId }, "No matching MeetingSession for recording.completed");
    return;
  }

  let transcribableRecordingId: string | null = null;
  for (const file of object.recording_files) {
    const fileType = RECORDING_FILE_TYPE_MAP[file.file_type] ?? "VIDEO";
    const recording = await prisma.recording.upsert({
      where: { externalRecordingId: file.id },
      update: { status: "AVAILABLE", fileSizeBytes: file.file_size },
      create: {
        meetingSessionId: meeting.id,
        fileType,
        status: "AVAILABLE",
        externalRecordingId: file.id,
        fileSizeBytes: file.file_size,
        // The Zoom download_url requires the same S2S bearer token to fetch
        // and expires quickly, so we don't persist it here — the
        // transcription job re-derives a fresh one via the Zoom API and
        // fills in storageKey once it has downloaded and re-uploaded the file.
      },
    });
    if (fileType === "VIDEO" || fileType === "AUDIO") {
      transcribableRecordingId = recording.id;
    }
  }

  await applyMeetingTransition(prisma, {
    meetingSessionId: meeting.id,
    toStatus: "PROCESSING",
    source: "WEBHOOK",
    message: `${object.recording_files.length} recording file(s) became available`,
    idempotencyKey: `recording.completed:${object.uuid ?? meetingId}`,
  });
  void notify(meeting.id, "RECORDING_READY", "Your meeting recording is ready.");

  const activeBot = await prisma.meetingBotSession.findFirst({
    where: { meetingSessionId: meeting.id, status: { notIn: ["FAILED", "CANCELLED"] } },
  });
  if (activeBot) {
    log.info({ meetingId: meeting.id }, "Notetaker covers this meeting; not transcribing the Zoom cloud recording");
    return;
  }

  if (meeting.transcriptEnabled && transcribableRecordingId) {
    await enqueueJob(
      QUEUE_NAMES.transcription,
      { meetingSessionId: meeting.id, recordingId: transcribableRecordingId },
      { singletonKey: buildJobId("transcribe", meeting.id) },
    );
    return;
  }

  // No transcript was requested (or there's no audio/video file to
  // transcribe) — this session is done as soon as the recording lands.
  const finalize = await applyMeetingTransition(prisma, {
    meetingSessionId: meeting.id,
    toStatus: "COMPLETED",
    source: "SYSTEM",
    message: "Recording available; no transcript was requested",
    idempotencyKey: `finalize-no-transcript:${meeting.id}`,
  });
  if (finalize.ok && !finalize.idempotentNoop) {
    void notify(meeting.id, "MEETING_COMPLETED", "Your meeting has completed.");
  }
}
