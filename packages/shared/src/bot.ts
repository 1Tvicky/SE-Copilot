import type { MeetingSessionStatus } from "./status.js";
import type { TranscriptSegmentInput } from "./ai-providers.js";

export type BotPlatform = "ZOOM" | "TEAMS";

export type BotSessionStatusValue =
  | "SCHEDULED"
  | "JOINING"
  | "WAITING_FOR_ADMISSION"
  | "JOINED"
  | "CAPTURING"
  | "CALL_ENDED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface ScheduleBotInput {
  meetingSessionId: string;
  platform: BotPlatform;
  meetingUrl: string;
  /** Always a clearly-AI identity, never a person's name. */
  botName: string;
  /** null = join as soon as possible (meeting already started or about to). */
  joinAt: Date | null;
  /** Posted in meeting chat when the bot joins, for transparency/consent. */
  joinMessage: string | null;
}

export interface ScheduledBot {
  externalBotId: string;
  joinAt: Date | null;
}

export interface BotTranscript {
  segments: TranscriptSegmentInput[];
  language: string | null;
}

export type BotTranscriptFetchResult =
  | { status: "ready"; transcript: BotTranscript }
  /** Provider is still producing it; try again later. */
  | { status: "pending" }
  /** Will never be available (captions disabled, bot never recorded, ...). */
  | { status: "unavailable"; reason: string };

/**
 * A platform-specific AI notetaker. Implementations must only use supported,
 * visible join mechanisms — the bot always appears as a named AI participant,
 * waits for admission like any guest, and never bypasses lobby, recording or
 * transcription restrictions.
 */
export interface MeetingBotProvider {
  readonly key: string;
  readonly platform: BotPlatform;
  isConfigured(): boolean;
  /** Platform-specific limitations to surface in the UI and docs. */
  limitations(): string[];
  scheduleBot(input: ScheduleBotInput): Promise<ScheduledBot>;
  /** Cancel a bot that has not joined yet. Returns false if it already joined (caller should use leave). */
  cancelBot(externalBotId: string): Promise<boolean>;
  leaveMeeting(externalBotId: string): Promise<void>;
  fetchTranscript(externalBotId: string): Promise<BotTranscriptFetchResult>;
}

// ---------------------------------------------------------------------------
// Recall.ai status mapping (pure, shared by webhook handler and tests)
// ---------------------------------------------------------------------------

export interface BotStatusMapping {
  botStatus: BotSessionStatusValue;
  /** Meeting status to move to, or null to leave the meeting status alone. */
  meetingStatus: MeetingSessionStatus | null;
  /** Failure message for the SE when this event ends capture without a transcript. */
  failureReason: string | null;
}

const SUB_CODE_REASONS: Record<string, string> = {
  timeout_exceeded_waiting_room: "The notetaker was never admitted from the waiting room/lobby.",
  bot_kicked_from_waiting_room: "The notetaker was denied entry from the waiting room/lobby.",
  bot_kicked_from_call: "The notetaker was removed from the meeting.",
  timeout_exceeded_noone_joined: "Nobody joined the meeting.",
  meeting_not_started: "The meeting was never started by the host.",
  timeout_exceeded_recording_permission_denied: "The host did not grant recording/transcription permission.",
  recording_permission_denied: "The host did not grant recording/transcription permission.",
  meeting_not_found: "The meeting link is invalid or the meeting no longer exists.",
  meeting_not_accessible: "The meeting is not accessible to guests.",
  meeting_requires_sign_in: "The meeting only admits signed-in users.",
  meeting_locked: "The meeting is locked.",
  meeting_full: "The meeting is full.",
  meeting_password_incorrect: "The meeting passcode was rejected.",
  meeting_ended: "The meeting ended before the notetaker joined.",
  zoom_web_disallowed: "The Zoom host disabled web join or uses end-to-end encryption.",
  zoom_email_required: "The Zoom meeting requires an email address to join.",
  microsoft_teams_sign_in_failed: "Teams sign-in for the notetaker failed.",
  microsoft_teams_captcha_error: "The Teams meeting blocks anonymous guests.",
  zoom_global_captions_disabled: "Zoom captions are disabled for this account, so no transcript was produced.",
  zoom_host_disabled_meeting_captions: "The host disabled captions, so no transcript was produced.",
};

export function describeBotSubCode(subCode: string | null | undefined): string | null {
  if (!subCode) return null;
  return SUB_CODE_REASONS[subCode] ?? null;
}

/**
 * Maps a Recall bot status code (from a `bot.<code>` webhook) to our bot and
 * meeting statuses. `call_ended` with a sub_code that means the bot never got
 * in (waiting room timeout etc.) is a capture failure, not a normal end.
 */
export function mapRecallBotStatus(code: string, subCode?: string | null): BotStatusMapping | null {
  switch (code) {
    case "joining_call":
      return { botStatus: "JOINING", meetingStatus: "JOINING", failureReason: null };
    case "in_waiting_room":
      return { botStatus: "WAITING_FOR_ADMISSION", meetingStatus: "WAITING_FOR_ADMISSION", failureReason: null };
    case "in_call_not_recording":
    case "recording_permission_allowed":
      return { botStatus: "JOINED", meetingStatus: "ACTIVE", failureReason: null };
    case "in_call_recording":
      return { botStatus: "CAPTURING", meetingStatus: "RECORDING", failureReason: null };
    case "recording_permission_denied":
      // The bot stays in the call briefly and then leaves (call_ended follows).
      return { botStatus: "JOINED", meetingStatus: null, failureReason: describeBotSubCode("recording_permission_denied") };
    case "call_ended": {
      const neverCaptured = new Set([
        "timeout_exceeded_waiting_room",
        "bot_kicked_from_waiting_room",
        "timeout_exceeded_noone_joined",
        "meeting_not_started",
        "timeout_exceeded_recording_permission_denied",
      ]);
      if (subCode && neverCaptured.has(subCode)) {
        return { botStatus: "FAILED", meetingStatus: "FAILED", failureReason: describeBotSubCode(subCode) ?? "Meeting capture unavailable." };
      }
      return { botStatus: "CALL_ENDED", meetingStatus: "PROCESSING", failureReason: null };
    }
    case "done":
      return { botStatus: "PROCESSING", meetingStatus: null, failureReason: null };
    case "fatal":
      return {
        botStatus: "FAILED",
        meetingStatus: "FAILED",
        failureReason: describeBotSubCode(subCode) ?? `The notetaker could not capture this meeting${subCode ? ` (${subCode})` : ""}.`,
      };
    default:
      return null;
  }
}

/**
 * Recall transcript download format: one entry per contiguous speaker turn.
 * With meeting-caption transcripts, `words` are caption segments.
 */
export interface RecallTranscriptEntry {
  participant?: { id?: number | string | null; name?: string | null } | null;
  language_code?: string | null;
  words: { text: string; start_timestamp?: { relative?: number | null } | null; end_timestamp?: { relative?: number | null } | null }[];
}

export function recallTranscriptToSegments(entries: RecallTranscriptEntry[]): BotTranscript {
  const segments: TranscriptSegmentInput[] = [];
  let language: string | null = null;
  for (const entry of entries) {
    if (!language && entry.language_code) language = entry.language_code;
    const words = entry.words ?? [];
    if (words.length === 0) continue;
    const text = words.map((w) => w.text.trim()).filter(Boolean).join(" ");
    if (!text) continue;
    const start = words[0]?.start_timestamp?.relative ?? 0;
    const end = words[words.length - 1]?.end_timestamp?.relative ?? start;
    segments.push({
      speakerLabel: entry.participant?.name?.trim() || null,
      startMs: Math.max(0, Math.round(start * 1000)),
      endMs: Math.max(0, Math.round(end * 1000)),
      text,
    });
  }
  return { segments, language };
}
