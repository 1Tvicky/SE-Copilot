import type { EmailAddress } from "./email.js";

/**
 * Provider abstractions for the MVP integrations. The core pipeline only ever
 * talks to these interfaces; Microsoft Graph is the first implementation of
 * each (apps/worker/src/integrations/graph), and Google Workspace can be added
 * later without touching callers.
 */

export type TeamMeetingSourceTypeValue = "SHARED_MAILBOX" | "GROUP_CALENDAR" | "DELEGATED_CALENDAR" | "FORWARDED_MAILBOX";

export interface TeamMeetingSourceRef {
  id: string;
  type: TeamMeetingSourceTypeValue;
  mailboxAddress: string | null;
  groupId: string | null;
}

export interface CalendarAttendee {
  email: string;
  name: string | null;
  type: "required" | "optional" | "resource";
  responseStatus: string | null;
}

/** A calendar event normalized away from any one provider's shape. */
export interface CalendarEventRecord {
  externalEventId: string;
  iCalUId: string | null;
  subject: string;
  bodyText: string;
  start: Date;
  end: Date;
  isCancelled: boolean;
  isPrivate: boolean;
  isAllDay: boolean;
  organizer: { email: string; name: string | null } | null;
  attendees: CalendarAttendee[];
  location: string | null;
  onlineMeetingJoinUrl: string | null;
  onlineMeetingProvider: string | null;
  lastModifiedAt: Date | null;
}

export interface CalendarProvider {
  readonly key: string;
  isConfigured(): boolean;
  /** Every event in [from, to], including cancelled ones (isCancelled = true). */
  listEvents(source: TeamMeetingSourceRef, from: Date, to: Date): Promise<CalendarEventRecord[]>;
  /** Cheap connectivity check for the Integrations page. */
  testConnection(source: TeamMeetingSourceRef): Promise<{ ok: boolean; message: string }>;
}

export interface OutboundEmail {
  /** The mailbox the provider authenticates as / sends through. */
  senderMailbox: string;
  /** The visible From address (e.g. the Team DL); may equal senderMailbox. */
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  html: string;
  /** Provider message id of the original invitation to reply to, if known. */
  replyToMessageId?: string | null;
}

export interface SentEmailResult {
  /** Provider id of the sent message, if the provider returns one. */
  providerMessageId: string | null;
  /** Whether the message was threaded as a reply to the original invitation. */
  threaded: boolean;
}

export interface EmailProvider {
  readonly key: string;
  isConfigured(): boolean;
  send(email: OutboundEmail): Promise<SentEmailResult>;
  /** Finds the original meeting-invitation message in `mailbox` so the follow-up can reply on its thread. */
  findInvitationMessage(mailbox: string, input: { subject: string; iCalUId: string | null }): Promise<string | null>;
  testConnection(senderMailbox: string): Promise<{ ok: boolean; message: string }>;
}
