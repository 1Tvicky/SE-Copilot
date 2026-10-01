import type { CalendarEventRecord, CalendarProvider, TeamMeetingSourceRef } from "@meeting-assistant/shared";
import { GraphError, graphPaginate, graphRequest, isGraphConfigured } from "./client.js";

interface GraphEmailAddress {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

export interface GraphEvent {
  id: string;
  iCalUId?: string | null;
  subject?: string | null;
  body?: { contentType?: string; content?: string | null } | null;
  bodyPreview?: string | null;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  isCancelled?: boolean;
  isAllDay?: boolean;
  sensitivity?: string | null;
  organizer?: GraphEmailAddress | null;
  attendees?: (GraphEmailAddress & { type?: string; status?: { response?: string } | null })[] | null;
  location?: { displayName?: string | null } | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  onlineMeetingProvider?: string | null;
  lastModifiedDateTime?: string | null;
}

const SELECT = [
  "id",
  "iCalUId",
  "subject",
  "body",
  "start",
  "end",
  "isCancelled",
  "isAllDay",
  "sensitivity",
  "organizer",
  "attendees",
  "location",
  "onlineMeeting",
  "onlineMeetingProvider",
  "lastModifiedDateTime",
].join(",");

/** Graph returns UTC times without a zone designator when Prefer: outlook.timezone="UTC" is set. */
export function parseGraphDateTime(value: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

export function normalizeGraphEvent(e: GraphEvent): CalendarEventRecord {
  const address = (x: GraphEmailAddress | null | undefined) => x?.emailAddress?.address?.trim().toLowerCase() ?? "";
  return {
    externalEventId: e.id,
    iCalUId: e.iCalUId ?? null,
    subject: e.subject?.trim() ?? "",
    bodyText: e.body?.content ?? e.bodyPreview ?? "",
    start: parseGraphDateTime(e.start.dateTime),
    end: parseGraphDateTime(e.end.dateTime),
    isCancelled: Boolean(e.isCancelled),
    isPrivate: e.sensitivity === "private" || e.sensitivity === "personal",
    isAllDay: Boolean(e.isAllDay),
    organizer: address(e.organizer) ? { email: address(e.organizer), name: e.organizer?.emailAddress?.name ?? null } : null,
    attendees: (e.attendees ?? [])
      .filter((a) => address(a))
      .map((a) => ({
        email: address(a),
        name: a.emailAddress?.name ?? null,
        type: a.type === "optional" ? "optional" : a.type === "resource" ? "resource" : "required",
        responseStatus: a.status?.response ?? null,
      })),
    location: e.location?.displayName ?? null,
    onlineMeetingJoinUrl: e.onlineMeeting?.joinUrl ?? null,
    onlineMeetingProvider: e.onlineMeetingProvider ?? null,
    lastModifiedAt: e.lastModifiedDateTime ? new Date(e.lastModifiedDateTime) : null,
  };
}

function calendarRoot(source: TeamMeetingSourceRef): string {
  if (source.type === "GROUP_CALENDAR") {
    if (!source.groupId) throw new GraphError("Group calendar source has no group id", 0, "invalid_source");
    return `/groups/${encodeURIComponent(source.groupId)}`;
  }
  if (!source.mailboxAddress) throw new GraphError("Mailbox source has no mailbox address", 0, "invalid_source");
  return `/users/${encodeURIComponent(source.mailboxAddress)}`;
}

/**
 * Reads a TeamMeetingSource via Graph calendarView, which expands recurring
 * meetings into individual occurrences (each with its own id) — exactly the
 * unit the notetaker needs to schedule against.
 */
export class GraphCalendarProvider implements CalendarProvider {
  readonly key = "microsoft-graph";

  isConfigured(): boolean {
    return isGraphConfigured();
  }

  async listEvents(source: TeamMeetingSourceRef, from: Date, to: Date): Promise<CalendarEventRecord[]> {
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: SELECT,
      $top: "100",
    });
    const events = await graphPaginate<GraphEvent>(`${calendarRoot(source)}/calendarView?${params.toString()}`, {
      Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"',
    });
    return events.map(normalizeGraphEvent);
  }

  async testConnection(source: TeamMeetingSourceRef): Promise<{ ok: boolean; message: string }> {
    try {
      const now = new Date();
      const params = new URLSearchParams({
        startDateTime: now.toISOString(),
        endDateTime: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        $select: "id",
        $top: "1",
      });
      await graphRequest(`${calendarRoot(source)}/calendarView?${params.toString()}`);
      return { ok: true, message: "Calendar is readable." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
