import { prisma, applyMeetingTransition, enqueueJob } from "@meeting-assistant/db";
import { buildJobId, mapRecallBotStatus, QUEUE_NAMES, type BotEventJobData } from "@meeting-assistant/shared";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";
import { notify } from "../notify.js";

/** Bot statuses that only move forward; an out-of-order older webhook must not regress them. */
const BOT_STATUS_ORDER = ["SCHEDULED", "JOINING", "WAITING_FOR_ADMISSION", "JOINED", "CAPTURING", "CALL_ENDED", "PROCESSING", "COMPLETED"];

export async function processBotEvent(job: JobContext<BotEventJobData>): Promise<void> {
  const { externalBotId, event, code, subCode, deliveryId } = job.data;
  const log = logger.child({ externalBotId, event, code, subCode });

  const bot = await prisma.meetingBotSession.findUnique({ where: { externalBotId } });
  if (!bot) {
    log.warn("Bot event for an unknown bot; ignoring");
    return;
  }

  // transcript.done / recording.done / bot.done all mean "go fetch it".
  if (event === "transcript.done" || code === "done") {
    await enqueueJob(QUEUE_NAMES.botTranscript, { botSessionId: bot.id }, { singletonKey: buildJobId("bot-transcript", bot.id) });
    if (event === "transcript.done") return;
  }
  if (event === "transcript.failed") {
    await failCapture(bot.id, bot.meetingSessionId, `No transcript was produced${subCode ? ` (${subCode})` : ""}.`, deliveryId);
    return;
  }
  if (!code) return;

  const mapping = mapRecallBotStatus(code, subCode);
  if (!mapping) {
    log.debug("Unmapped bot status; ignoring");
    return;
  }

  const occurredAt = job.data.occurredAt ? new Date(job.data.occurredAt) : new Date();
  // Terminal bot states are final, and status only moves forward: webhooks
  // can arrive late or out of order and must never resurrect or rewind a bot.
  const terminal = bot.status === "CANCELLED" || bot.status === "COMPLETED" || bot.status === "FAILED";
  const regress =
    mapping.botStatus !== "FAILED" && BOT_STATUS_ORDER.indexOf(mapping.botStatus) < BOT_STATUS_ORDER.indexOf(bot.status);
  if (terminal || regress) {
    log.info({ current: bot.status }, "Ignoring stale/out-of-order bot event");
    return;
  }

  await prisma.meetingBotSession.update({
    where: { id: bot.id },
    data: {
      status: mapping.botStatus,
      lastStatusCode: code,
      lastSubCode: subCode,
      lastEventAt: occurredAt,
      ...(mapping.botStatus === "JOINED" || mapping.botStatus === "CAPTURING" ? { joinedAt: bot.joinedAt ?? occurredAt } : {}),
      ...(mapping.botStatus === "CALL_ENDED" ? { leftAt: occurredAt } : {}),
      ...(mapping.failureReason ? { failureReason: mapping.failureReason } : {}),
    },
  });

  if (mapping.meetingStatus === "FAILED") {
    await failCapture(bot.id, bot.meetingSessionId, mapping.failureReason ?? "Meeting capture unavailable.", deliveryId);
    return;
  }

  if (mapping.meetingStatus) {
    const result = await applyMeetingTransition(prisma, {
      meetingSessionId: bot.meetingSessionId,
      toStatus: mapping.meetingStatus,
      source: "WEBHOOK",
      message: `Notetaker: ${code}${subCode ? ` (${subCode})` : ""}`,
      idempotencyKey: `recall:${deliveryId}`,
      extraData: {
        ...(mapping.meetingStatus === "RECORDING" || mapping.meetingStatus === "ACTIVE" ? { startedAt: occurredAt } : {}),
        ...(mapping.meetingStatus === "PROCESSING" ? { endedAt: occurredAt } : {}),
      },
    });
    if (!result.ok) log.info({ reason: result.reason }, "Meeting transition skipped");
    if (result.ok && !result.idempotentNoop && (mapping.meetingStatus === "ACTIVE" || mapping.meetingStatus === "RECORDING") && !bot.joinedAt) {
      void notify(bot.meetingSessionId, "BOT_JOINED", "SE Copilot Notetaker was admitted and is capturing the meeting.");
    }
  }
}

async function failCapture(botSessionId: string, meetingSessionId: string, reason: string, deliveryId: string) {
  await prisma.meetingBotSession.update({ where: { id: botSessionId }, data: { status: "FAILED", failureReason: reason } });
  const result = await applyMeetingTransition(prisma, {
    meetingSessionId,
    toStatus: "FAILED",
    source: "WEBHOOK",
    message: `Meeting capture unavailable: ${reason}`,
    idempotencyKey: `recall-failed:${deliveryId}`,
    extraData: { failureReason: `Meeting capture unavailable: ${reason}` },
  });
  if (result.ok && !result.idempotentNoop) {
    void notify(
      meetingSessionId,
      "BOT_FAILED",
      `Meeting capture unavailable: ${reason} You can upload or paste a transcript, or add your notes, and generate the MOM from that.`,
    );
  }
}
