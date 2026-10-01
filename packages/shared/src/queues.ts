/**
 * Queue names and job payload shapes shared between apps/web (enqueues jobs
 * from API routes) and apps/worker (consumes them). Jobs run on pg-boss, so
 * the queue lives in the same Postgres database as everything else — one
 * queue per job type.
 */

export const QUEUE_NAMES = {
  /** Pull meetings from every enabled TeamMeetingSource (cron + on demand). */
  calendarSync: "calendar-sync",
  /** Reconcile one meeting's notetaker bot with what it should be (schedule / reschedule / cancel). */
  botSchedule: "bot-schedule",
  /** A verified status webhook from the bot provider. */
  botEvents: "bot-events",
  /** Download the bot's transcript once the provider says it is ready. */
  botTranscript: "bot-transcript",
  /** Safety net: if capture never completes, mark the meeting "capture unavailable". */
  captureTimeout: "capture-timeout",
  /** Zoom cloud-recording webhooks (fallback capture path for Zoom-account-hosted meetings). */
  zoomWebhookEvents: "zoom-webhook-events",
  /** Speech-to-text of a downloaded Zoom cloud recording. */
  transcription: "transcription",
  /** Transcript + notes + context -> analysis, MOM draft, action items. */
  meetingAnalysis: "meeting-analysis",
  /** Send an SE-confirmed customer email. */
  emailSend: "email-send",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);

/**
 * Deterministic singleton keys. Kept colon-free and built in one place so
 * every producer of the same logical job derives the same key.
 */
export function buildJobId(...parts: (string | number)[]): string {
  return parts.join("-");
}

export interface CalendarSyncJobData {
  /** Sync only this source; omitted = every enabled source. */
  sourceId?: string;
}

export interface BotScheduleJobData {
  meetingSessionId: string;
}

export interface BotEventJobData {
  provider: "recall";
  event: string;
  externalBotId: string;
  code: string | null;
  subCode: string | null;
  occurredAt: string | null;
  /** Unique id of the webhook delivery, for idempotency. */
  deliveryId: string;
}

export interface BotTranscriptJobData {
  botSessionId: string;
}

export interface CaptureTimeoutJobData {
  meetingSessionId: string;
}

/** Enqueued by the web app's Zoom webhook receiver for the worker to process. */
export interface ZoomWebhookJobData {
  eventType: string;
  eventTs: number;
  payload: Record<string, unknown>;
}

/** Enqueued once a Zoom cloud recording is AVAILABLE, to generate a transcript. */
export interface TranscriptionJobData {
  meetingSessionId: string;
  recordingId: string;
}

export interface MeetingAnalysisJobData {
  meetingSessionId: string;
  reason: "capture" | "manual" | "regenerate";
  requestedById?: string;
}

export interface EmailSendJobData {
  emailMessageId: string;
}
