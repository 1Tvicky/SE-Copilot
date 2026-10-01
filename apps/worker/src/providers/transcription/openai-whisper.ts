import type { TranscriptionProvider, TranscriptionResult } from "@meeting-assistant/shared";

const WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperVerboseResponse {
  language?: string;
  segments?: WhisperSegment[];
}

/**
 * OpenAI's Whisper API. Note: this endpoint does not diarize (identify
 * distinct speakers) — supportsSpeakerLabels is false and every segment's
 * speakerLabel is null, rather than fabricating speaker names.
 */
export class OpenAiWhisperProvider implements TranscriptionProvider {
  readonly name = "openai-whisper-1";

  async transcribeAudio(input: { audioBuffer: Buffer; mimeType: string }): Promise<TranscriptionResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const form = new FormData();
    const extension = input.mimeType.includes("mp4") ? "mp4" : input.mimeType.includes("webm") ? "webm" : "m4a";
    form.append("file", new Blob([input.audioBuffer], { type: input.mimeType }), `recording.${extension}`);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const res = await fetch(WHISPER_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI transcription request failed with status ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as WhisperVerboseResponse;

    return {
      language: data.language ?? null,
      supportsSpeakerLabels: false,
      segments: (data.segments ?? []).map((seg) => ({
        speakerLabel: null,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        text: seg.text.trim(),
      })),
    };
  }
}
