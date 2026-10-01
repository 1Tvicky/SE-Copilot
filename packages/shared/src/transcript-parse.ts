import type { TranscriptSegmentInput } from "./ai-providers.js";

/**
 * Parses a transcript the SE uploaded or pasted when automated capture was
 * unavailable. Handles WebVTT (Zoom/Teams downloads, including Teams'
 * `<v Speaker Name>` voice tags), SRT, and plain text where each line is
 * optionally prefixed with "Speaker: ". Timestamps are kept when present and
 * zero otherwise; nothing is invented.
 */
export function parseTranscriptText(raw: string): TranscriptSegmentInput[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (/^WEBVTT/.test(text) || /\d{2}:\d{2}[:.,]\d{2}[.,]\d{1,3}\s+-->\s+/.test(text)) {
    const cues = parseCues(text);
    if (cues.length > 0) return mergeAdjacent(cues);
  }
  return parsePlain(text);
}

function timestampToMs(ts: string): number {
  // hh:mm:ss.mmm | mm:ss.mmm | hh:mm:ss,mmm
  const parts = ts.trim().replace(",", ".").split(":");
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function parseCues(text: string): TranscriptSegmentInput[] {
  const blocks = text.split(/\n{2,}/);
  const segments: TranscriptSegmentInput[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex === -1) continue;
    const [startRaw, endRaw] = lines[timingIndex]!.split("-->");
    const startMs = timestampToMs(startRaw ?? "0");
    const endMs = timestampToMs((endRaw ?? "").trim().split(/\s+/)[0] ?? "0");
    let body = lines.slice(timingIndex + 1).join(" ").trim();
    let speakerLabel: string | null = null;

    const voice = /^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/.exec(body);
    if (voice) {
      speakerLabel = voice[1]!.trim();
      body = voice[2]!.trim();
    } else {
      const prefixed = /^([^:]{1,60}):\s+(.+)$/.exec(body);
      if (prefixed && !/^\d+$/.test(prefixed[1]!)) {
        speakerLabel = prefixed[1]!.trim();
        body = prefixed[2]!.trim();
      }
    }
    body = body.replace(/<[^>]+>/g, "").trim();
    if (body) segments.push({ speakerLabel, startMs, endMs: Math.max(endMs, startMs), text: body });
  }
  return segments;
}

/** Consecutive cues from the same speaker are one turn; keeps transcripts readable and prompts smaller. */
function mergeAdjacent(segments: TranscriptSegmentInput[]): TranscriptSegmentInput[] {
  const merged: TranscriptSegmentInput[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speakerLabel === seg.speakerLabel && seg.startMs - prev.endMs < 5_000) {
      prev.text = `${prev.text} ${seg.text}`;
      prev.endMs = seg.endMs;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function parsePlain(text: string): TranscriptSegmentInput[] {
  const segments: TranscriptSegmentInput[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Optional leading "[00:12:03]" or "00:12:03" timestamp.
    let rest = trimmed;
    let startMs = 0;
    const ts = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.*)$/.exec(rest);
    if (ts) {
      startMs = timestampToMs(ts[1]!);
      rest = ts[2]!;
    }
    const prefixed = /^([A-Z][^:]{0,59}):\s+(.+)$/.exec(rest);
    const prev = segments[segments.length - 1];
    if (prefixed) {
      segments.push({ speakerLabel: prefixed[1]!.trim(), startMs, endMs: startMs, text: prefixed[2]!.trim() });
    } else if (prev && !ts) {
      prev.text = `${prev.text} ${rest}`;
    } else {
      segments.push({ speakerLabel: null, startMs, endMs: startMs, text: rest });
    }
  }
  return segments;
}
