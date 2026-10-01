import { prisma, applyMeetingTransition, enqueueJob, ingestCalendarEvent, refreshBotEligibility } from "@meeting-assistant/db";
import { buildJobId, QUEUE_NAMES, type CalendarSyncJobData, type TeamMeetingSourceRef } from "@meeting-assistant/shared";
import { GraphCalendarProvider } from "../integrations/graph/calendar-provider.js";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";

const calendar = new GraphCalendarProvider();
/** Look back a few hours so meetings that started before the worker came up are still picked up. */
const LOOKBACK_MS = 6 * 3600_000;

export async function processCalendarSync(job: JobContext<CalendarSyncJobData>): Promise<void> {
  if (!calendar.isConfigured()) {
    logger.debug("Calendar sync skipped: Microsoft Graph not configured");
    return;
  }
  const sources = await prisma.teamMeetingSource.findMany({
    where: { isEnabled: true, ...(job.data.sourceId ? { id: job.data.sourceId } : {}) },
    include: { team: true },
  });

  for (const source of sources) {
    const log = logger.child({ sourceId: source.id, source: source.displayName });
    const from = new Date(Date.now() - LOOKBACK_MS);
    const to = new Date(Date.now() + source.syncDaysAhead * 24 * 3600_000);
    try {
      const ref: TeamMeetingSourceRef = { id: source.id, type: source.type, mailboxAddress: source.mailboxAddress, groupId: source.groupId };
      const events = await calendar.listEvents(ref, from, to);
      const seen = new Set<string>();
      let created = 0;
      let toReconcile: string[] = [];

      for (const event of events) {
        seen.add(event.externalEventId);
        const result = await ingestCalendarEvent(prisma, source.team, source.id, event);
        if (result.created) created++;
        if (result.meetingSessionId && result.botRelevantChange) toReconcile.push(result.meetingSessionId);
      }

      // Events that disappeared from the window were deleted from the calendar.
      const vanished = await prisma.meetingSession.findMany({
        where: {
          sourceId: source.id,
          origin: "CALENDAR",
          scheduledAt: { gte: from, lte: to },
          status: { in: ["SCHEDULED", "PREPARING"] },
          externalEventId: { notIn: [...seen] },
        },
        select: { id: true },
      });
      for (const m of vanished) {
        await applyMeetingTransition(prisma, {
          meetingSessionId: m.id,
          toStatus: "CANCELLED",
          source: "SYSTEM",
          message: "Event was removed from the team calendar",
          idempotencyKey: `calendar-removed:${m.id}`,
          extraData: { cancelledAt: new Date() },
        });
        await refreshBotEligibility(prisma, m.id, { isCancelled: true });
        toReconcile.push(m.id);
      }

      toReconcile = [...new Set(toReconcile)];
      for (const meetingSessionId of toReconcile) {
        await enqueueJob(QUEUE_NAMES.botSchedule, { meetingSessionId }, { singletonKey: buildJobId("bot", meetingSessionId) });
      }

      await prisma.teamMeetingSource.update({
        where: { id: source.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "ok", lastSyncError: null, lastSyncEventCount: events.length },
      });
      log.info({ events: events.length, created, cancelled: vanished.length, reconciled: toReconcile.length }, "Calendar sync complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, "Calendar sync failed");
      await prisma.teamMeetingSource.update({
        where: { id: source.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "error", lastSyncError: message.slice(0, 2000) },
      });
    }
  }
}
