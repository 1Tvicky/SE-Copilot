import type { PrismaClient } from "@meeting-assistant/db";
import { isTerminalStatus } from "@meeting-assistant/shared";
import { logger } from "../logger.js";

/**
 * Zoom identifies a meeting by numeric id (reusable across recurring
 * occurrences) and by a per-occurrence uuid. We store meetingId at creation
 * time and backfill externalMeetingUuid on the first webhook we see for it,
 * so a later webhook for the SAME occurrence can match precisely even if
 * the user scheduled the same recurring meeting ID more than once.
 */
export async function findMeetingSessionForZoomObject(
  db: PrismaClient,
  { meetingId, uuid }: { meetingId: string; uuid?: string },
) {
  if (uuid) {
    const byUuid = await db.meetingSession.findFirst({ where: { externalMeetingUuid: uuid } });
    if (byUuid) return byUuid;
  }

  const candidates = await db.meetingSession.findMany({
    where: { meetingId, platform: "ZOOM" },
    orderBy: { scheduledAt: "asc" },
  });
  const openCandidates = candidates.filter((c) => !isTerminalStatus(c.status));

  if (openCandidates.length > 1) {
    logger.warn(
      { meetingId, count: openCandidates.length },
      "Multiple open meeting sessions share this Zoom meeting ID; picking the earliest-scheduled one",
    );
  }

  return openCandidates[0] ?? null;
}
