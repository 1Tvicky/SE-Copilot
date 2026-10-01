import { prisma, applyMeetingTransition, enqueueJob } from "@meeting-assistant/db";
import { buildJobId, isFinalJobAttempt, QUEUE_NAMES, type BotTranscriptJobData } from "@meeting-assistant/shared";
import { getMeetingBotProvider } from "../integrations/recall/recall-bot-provider.js";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";
import { notify } from "../notify.js";

export class TranscriptNotReadyError extends Error {}

/**
 * Downloads the notetaker's transcript into our own database (the
 * provider's download links expire), then hands off to analysis. "Not ready
 * yet" is a retryable failure; "will never be ready" fails capture cleanly.
 */
export async function processBotTranscript(job: JobContext<BotTranscriptJobData>): Promise<void> {
  const bot = await prisma.meetingBotSession.findUnique({ where: { id: job.data.botSessionId }, include: { meetingSession: true } });
  if (!bot?.externalBotId) return;
  const meeting = bot.meetingSession;
  const log = logger.child({ meetingSessionId: meeting.id, externalBotId: bot.externalBotId });

  const already = await prisma.transcript.findFirst({ where: { meetingSessionId: meeting.id, source: "MEETING_BOT", status: "READY" } });
  if (already) return;

  const provider = getMeetingBotProvider(meeting.platform === "TEAMS" ? "TEAMS" : "ZOOM");
  const result = await provider.fetchTranscript(bot.externalBotId);

  if (result.status === "pending") {
    if (isFinalJobAttempt(job.retryCount, job.retryLimit)) {
      await unavailable("The transcript was not ready after repeated checks.");
      return;
    }
    throw new TranscriptNotReadyError("Transcript not ready yet");
  }
  if (result.status === "unavailable" || result.transcript.segments.length === 0) {
    await unavailable(result.status === "unavailable" ? result.reason : "The transcript was empty.");
    return;
  }

  const { segments, language } = result.transcript;
  await prisma.$transaction(async (tx) => {
    const transcript = await tx.transcript.create({
      data: { meetingSessionId: meeting.id, source: "MEETING_BOT", status: "READY", provider: provider.key, language, generatedAt: new Date() },
    });
    await tx.transcriptSegment.createMany({ data: segments.map((s) => ({ ...s, transcriptId: transcript.id })) });
    await tx.meetingBotSession.update({ where: { id: bot.id }, data: { status: "COMPLETED", transcriptReadyAt: new Date() } });
  });
  log.info({ segments: segments.length }, "Notetaker transcript stored");

  await applyMeetingTransition(prisma, {
    meetingSessionId: meeting.id,
    toStatus: "PROCESSING",
    source: "WORKER",
    message: "Transcript captured; analyzing",
    idempotencyKey: `bot-transcript:${bot.id}`,
  });
  await enqueueJob(
    QUEUE_NAMES.meetingAnalysis,
    { meetingSessionId: meeting.id, reason: "capture" },
    { singletonKey: buildJobId("analysis", meeting.id) },
  );

  async function unavailable(reason: string) {
    await prisma.meetingBotSession.update({ where: { id: bot!.id }, data: { status: "FAILED", failureReason: reason } });
    const t = await applyMeetingTransition(prisma, {
      meetingSessionId: meeting.id,
      toStatus: "FAILED",
      source: "WORKER",
      message: `Meeting capture unavailable: ${reason}`,
      idempotencyKey: `bot-transcript-unavailable:${bot!.id}`,
      extraData: { failureReason: `Meeting capture unavailable: ${reason}` },
    });
    if (t.ok && !t.idempotentNoop) {
      void notify(meeting.id, "BOT_FAILED", `Meeting capture unavailable: ${reason} Upload/paste a transcript or add notes to generate the MOM.`);
    }
    log.warn({ reason }, "Notetaker transcript unavailable");
  }
}
