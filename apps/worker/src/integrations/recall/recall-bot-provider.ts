import {
  recallTranscriptToSegments,
  type BotPlatform,
  type BotTranscriptFetchResult,
  type MeetingBotProvider,
  type RecallTranscriptEntry,
  type ScheduleBotInput,
  type ScheduledBot,
} from "@meeting-assistant/shared";

/**
 * Recall.ai meeting bot API (https://docs.recall.ai). One bot is a visible
 * meeting participant with the name we give it; it waits in the
 * lobby/waiting room like any guest and only transcribes once admitted.
 */
export class RecallApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RecallApiError";
  }
}

function baseUrl(): string {
  return (process.env.RECALL_API_BASE_URL ?? "https://us-east-1.recall.ai").replace(/\/+$/, "");
}

async function recallRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const key = process.env.RECALL_API_KEY;
  if (!key) throw new RecallApiError("RECALL_API_KEY is not configured", 0);
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Token ${key}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = (text ? safeJson(text) : null) as T;
  if (!res.ok && res.status !== 405) {
    throw new RecallApiError(`Recall ${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 500)}`, res.status);
  }
  return { status: res.status, data };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface RecallBot {
  id: string;
  join_at?: string | null;
  recordings?: {
    id: string;
    media_shortcuts?: {
      transcript?: {
        status?: { code?: string; sub_code?: string | null } | null;
        data?: { download_url?: string | null } | null;
      } | null;
    } | null;
  }[];
  status_changes?: { code: string; sub_code?: string | null; created_at?: string }[];
}

type TranscriptProviderName = "meeting_captions" | "recallai_streaming";

function transcriptProviderConfig(): Record<string, unknown> {
  const name = (process.env.RECALL_TRANSCRIPT_PROVIDER ?? "meeting_captions") as TranscriptProviderName;
  // meeting_captions uses the platform's own captions (no extra cost, needs
  // captions enabled); recallai_streaming is Recall's own ASR (billed, works
  // even when captions are disabled).
  return name === "recallai_streaming" ? { recallai_streaming: { mode: "prioritize_accuracy" } } : { meeting_captions: {} };
}

abstract class RecallMeetingBotProvider implements MeetingBotProvider {
  readonly key = "recall";
  abstract readonly platform: BotPlatform;

  isConfigured(): boolean {
    return Boolean(process.env.RECALL_API_KEY);
  }

  abstract limitations(): string[];

  async scheduleBot(input: ScheduleBotInput): Promise<ScheduledBot> {
    const { data } = await recallRequest<RecallBot>("/api/v1/bot/", {
      method: "POST",
      body: {
        meeting_url: input.meetingUrl,
        bot_name: input.botName,
        // Recall treats join_at < 10 minutes ahead as an ad-hoc bot that joins ASAP.
        ...(input.joinAt ? { join_at: input.joinAt.toISOString() } : {}),
        metadata: { meeting_session_id: input.meetingSessionId, app: "se-copilot" },
        recording_config: { transcript: { provider: transcriptProviderConfig() } },
        automatic_leave: {
          waiting_room_timeout: 900,
          noone_joined_timeout: 900,
          recording_permission_denied_timeout: 60,
        },
        ...(input.joinMessage ? { chat: { on_bot_join: { send_to: "everyone", message: input.joinMessage } } } : {}),
      },
    });
    return { externalBotId: data.id, joinAt: data.join_at ? new Date(data.join_at) : input.joinAt };
  }

  async cancelBot(externalBotId: string): Promise<boolean> {
    // 204 = scheduled bot deleted; 405 = it already joined (use leave instead).
    const { status } = await recallRequest(`/api/v1/bot/${encodeURIComponent(externalBotId)}/`, { method: "DELETE" });
    return status !== 405;
  }

  async leaveMeeting(externalBotId: string): Promise<void> {
    await recallRequest(`/api/v1/bot/${encodeURIComponent(externalBotId)}/leave_call/`, { method: "POST" });
  }

  async fetchTranscript(externalBotId: string): Promise<BotTranscriptFetchResult> {
    const { data: bot } = await recallRequest<RecallBot>(`/api/v1/bot/${encodeURIComponent(externalBotId)}/`);
    const recording = bot.recordings?.[0];
    if (!recording) {
      const finished = bot.status_changes?.some((s) => s.code === "done" || s.code === "fatal");
      return finished ? { status: "unavailable", reason: "The notetaker never recorded this meeting." } : { status: "pending" };
    }
    const transcript = recording.media_shortcuts?.transcript;
    const code = transcript?.status?.code;
    if (code === "failed" || code === "deleted") {
      return { status: "unavailable", reason: `Transcript ${code}${transcript?.status?.sub_code ? ` (${transcript.status.sub_code})` : ""}.` };
    }
    const url = transcript?.data?.download_url;
    if (code !== "done" || !url) return { status: "pending" };

    // Pre-signed URL: no auth header (sending one can make S3 reject the request).
    const res = await fetch(url);
    if (!res.ok) throw new RecallApiError(`Transcript download failed (${res.status})`, res.status);
    const entries = (await res.json()) as RecallTranscriptEntry[];
    return { status: "ready", transcript: recallTranscriptToSegments(entries) };
  }
}

export class ZoomMeetingBotProvider extends RecallMeetingBotProvider {
  readonly platform = "ZOOM" as const;

  limitations(): string[] {
    return [
      "The bot joins as a guest and must be admitted from the waiting room if one is enabled.",
      "The Zoom host must grant recording permission; if they decline, the bot leaves and capture is unavailable.",
      "With caption-based transcripts, Zoom captions must be enabled for the host's account.",
      "Zoom meetings with web join disabled or end-to-end encryption enabled can't be joined.",
      "Since March 2026 Zoom requires an OBF token for SDK bots joining externally hosted meetings; confirm your Recall.ai workspace setup covers this (docs/setup/zoom.md).",
    ];
  }
}

export class MicrosoftTeamsMeetingBotProvider extends RecallMeetingBotProvider {
  readonly platform = "TEAMS" as const;

  limitations(): string[] {
    return [
      "The bot joins anonymously and waits in the lobby until someone admits it, unless the organizer lets guests bypass the lobby.",
      "Meetings that block anonymous guests can't be joined.",
      "Caption-based transcripts require a Teams business account; live events, town halls and breakout rooms are not supported.",
    ];
  }
}

const providers: Record<BotPlatform, MeetingBotProvider> = {
  ZOOM: new ZoomMeetingBotProvider(),
  TEAMS: new MicrosoftTeamsMeetingBotProvider(),
};

export function getMeetingBotProvider(platform: BotPlatform): MeetingBotProvider {
  return providers[platform];
}
