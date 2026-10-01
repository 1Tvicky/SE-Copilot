import { prisma, enqueueJob } from "@meeting-assistant/db";
import { buildJobId, computeBotJoinAt, QUEUE_NAMES, type BotScheduleJobData } from "@meeting-assistant/shared";
import { getMeetingBotProvider } from "../integrations/recall/recall-bot-provider.js";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";

/** Minutes after the scheduled end before an uncaptured meeting is declared "capture unavailable". */
export const CAPTURE_TIMEOUT_GRACE_MINUTES = 60;

/**
 * Reconciles one meeting's notetaker with what it should be. Idempotent and
 * safe to run any number of times: it compares the desired state (eligible?
 * join when? which URL?) against the latest not-yet-joined bot and only
 * creates/cancels when they differ. Handles new meetings, reschedules,
 * link changes, cancellations and SE overrides with one code path.
 */
export async function processBotSchedule(job: JobContext<BotScheduleJobData>): Promise<void> {
  const { meetingSessionId } = job.data;
  const log = logger.child({ meetingSessionId });
  const meeting = await prisma.meetingSession.findUnique({
    where: { id: meetingSessionId },
    include: { team: true, botSessions: { where: { status: "SCHEDULED" }, orderBy: { createdAt: "desc" } } },
  });
  if (!meeting) return;

  const pending = meeting.botSessions;
  const now = new Date();
  const desired =
    meeting.botEligible &&
    (meeting.platform === "ZOOM" || meeting.platform === "TEAMS") &&
    Boolean(meeting.meetingUrl) &&
    ["SCHEDULED", "PREPARING"].includes(meeting.status) &&
    (meeting.endsAt ?? new Date(meeting.scheduledAt.getTime() + meeting.maxDurationMinutes * 60_000)) > now;

  const cancelPending = async (reason: string) => {
    for (const bot of pending) {
      if (!bot.externalBotId) continue;
      const provider = getMeetingBotProvider(meeting.platform === "TEAMS" ? "TEAMS" : "ZOOM");
      const cancelled = await provider.cancelBot(bot.externalBotId);
      // If it already joined, Recall refused the delete; the bot's own status webhooks take over from here.
      if (cancelled) {
        await prisma.meetingBotSession.update({ where: { id: bot.id }, data: { status: "CANCELLED", failureReason: reason } });
        log.info({ botId: bot.externalBotId, reason }, "Cancelled scheduled notetaker");
      }
    }
  };

  if (!desired) {
    if (pending.length) await cancelPending(meeting.botIneligibleReason ?? `Meeting is ${meeting.status.toLowerCase()}`);
    return;
  }

  const platform = meeting.platform === "TEAMS" ? "TEAMS" : "ZOOM";
  const provider = getMeetingBotProvider(platform);
  const joinAt = computeBotJoinAt(meeting.scheduledAt, meeting.team?.botJoinOffsetMinutes ?? 1, now);
  const botName = meeting.team?.botDisplayName ?? "SE Copilot Notetaker";

  const current = pending[0];
  const upToDate =
    current &&
    current.botName === botName &&
    ((joinAt === null && (current.joinAt === null || current.joinAt <= now)) ||
      (joinAt !== null && current.joinAt !== null && Math.abs(current.joinAt.getTime() - joinAt.getTime()) < 30_000));
  if (upToDate && pending.length === 1) return;

  // Reschedule = cancel the old bot(s), create a fresh one. Simpler and safer
  // than patching: a stale bot can never join at the old time.
  if (pending.length) await cancelPending("Rescheduled");

  const scheduled = await provider.scheduleBot({
    meetingSessionId,
    platform,
    meetingUrl: meeting.meetingUrl!,
    botName,
    joinAt,
    joinMessage: meeting.team?.botJoinMessage ?? null,
  });
  await prisma.meetingBotSession.create({
    data: {
      meetingSessionId,
      provider: provider.key,
      externalBotId: scheduled.externalBotId,
      status: "SCHEDULED",
      botName,
      joinAt: scheduled.joinAt,
    },
  });
  log.info({ botId: scheduled.externalBotId, joinAt: scheduled.joinAt?.toISOString() ?? "now" }, "Notetaker scheduled");

  const endsAt = meeting.endsAt ?? new Date(meeting.scheduledAt.getTime() + meeting.maxDurationMinutes * 60_000);
  await enqueueJob(
    QUEUE_NAMES.captureTimeout,
    { meetingSessionId },
    { singletonKey: buildJobId("capture-timeout", meetingSessionId), startAfter: new Date(endsAt.getTime() + CAPTURE_TIMEOUT_GRACE_MINUTES * 60_000) },
  );
}
