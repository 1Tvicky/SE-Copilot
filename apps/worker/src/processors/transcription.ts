import { prisma, applyMeetingTransition, enqueueJob } from "@meeting-assistant/db";
import { buildJobId, isFinalJobAttempt, QUEUE_NAMES, type TranscriptionJobData } from "@meeting-assistant/shared";
import { downloadZoomRecordingFile } from "../zoom/download-recording.js";
import { buildStorageKey, uploadBuffer } from "../storage.js";
import { OpenAiWhisperProvider } from "../providers/transcription/openai-whisper.js";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";
import { notify } from "../notify.js";

const provider = new OpenAiWhisperProvider();

export async function processTranscriptionJob(job: JobContext<TranscriptionJobData>): Promise<void> {
  const { meetingSessionId, recordingId } = job.data;
  const log = logger.child({ meetingSessionId, recordingId, jobId: job.id });

  const [meeting, recording] = await Promise.all([
    prisma.meetingSession.findUnique({ where: { id: meetingSessionId } }),
    prisma.recording.findUnique({ where: { id: recordingId } }),
  ]);
  if (!meeting || !recording) {
    log.warn("Meeting or recording no longer exists; skipping");
    return;
  }

  const existing = await prisma.transcript.findFirst({ where: { meetingSessionId } });
  const transcriptRecord = existing
    ? await prisma.transcript.update({ where: { id: existing.id }, data: { status: "PROCESSING", recordingId } })
    : await prisma.transcript.create({ data: { meetingSessionId, recordingId, source: "RECORDING_TRANSCRIPTION", status: "PROCESSING" } });

  try {
    const meetingIdentifier = meeting.externalMeetingUuid ?? meeting.meetingId;
    if (!meetingIdentifier) throw new Error("Meeting has no Zoom identifier to download recordings from");
    if (!recording.externalRecordingId) throw new Error("Recording has no externalRecordingId");

    const { buffer, mimeType } = await downloadZoomRecordingFile(
      meetingIdentifier,
      recording.externalRecordingId,
    );

    const storageKey = buildStorageKey("recordings", meetingSessionId, `recording.${mimeType.split("/")[1] ?? "bin"}`);
    await uploadBuffer(storageKey, buffer, mimeType);
    await prisma.recording.update({ where: { id: recording.id }, data: { storageKey, isPrivate: true } });

    const result = await provider.transcribeAudio({ audioBuffer: buffer, mimeType });

    await prisma.$transaction([
      prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcriptRecord.id } }),
      prisma.transcriptSegment.createMany({
        data: result.segments.map((seg) => ({
          transcriptId: transcriptRecord.id,
          speakerLabel: seg.speakerLabel,
          startMs: seg.startMs,
          endMs: seg.endMs,
          text: seg.text,
        })),
      }),
      prisma.transcript.update({
        where: { id: transcriptRecord.id },
        data: { status: "READY", provider: provider.name, language: result.language, generatedAt: new Date() },
      }),
    ]);

    void notify(meetingSessionId, "TRANSCRIPT_READY", "Your meeting transcript is ready.");

    if (meeting.summaryEnabled) {
      await enqueueJob(
        QUEUE_NAMES.meetingAnalysis,
        { meetingSessionId, reason: "capture" },
        { singletonKey: buildJobId("analysis", meetingSessionId) },
      );
      return;
    }

    const finalize = await applyMeetingTransition(prisma, {
      meetingSessionId,
      toStatus: "COMPLETED",
      source: "SYSTEM",
      message: "Transcript ready; no summary was requested",
      idempotencyKey: `finalize-no-summary:${meetingSessionId}`,
    });
    if (finalize.ok && !finalize.idempotentNoop) {
      void notify(meetingSessionId, "MEETING_COMPLETED", "Your meeting has completed.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown transcription error";
    log.error({ err, attempt: job.retryCount + 1 }, "Transcription attempt failed");

    // Only give up (and fail the whole meeting) once pg-boss has exhausted
    // its retries — an earlier attempt failing must not permanently mark
    // the meeting FAILED, since FAILED is a terminal state a later
    // successful retry could never recover from.
    if (isFinalJobAttempt(job.retryCount, job.retryLimit)) {
      await prisma.transcript.update({
        where: { id: transcriptRecord.id },
        data: { status: "FAILED", failureReason: message },
      });
      await applyMeetingTransition(prisma, {
        meetingSessionId,
        toStatus: "FAILED",
        source: "SYSTEM",
        message: "Transcription failed",
        idempotencyKey: `transcription-failed:${meetingSessionId}`,
        extraData: { failureReason: `Transcription failed: ${message}` },
      });
      void notify(meetingSessionId, "MEETING_FAILED", `Transcription failed: ${message}`);
    }
    throw err;
  }
}
