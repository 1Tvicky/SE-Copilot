import { describe, expect, it } from "vitest";
import { mapRecallBotStatus, recallTranscriptToSegments } from "./bot.js";
import { parseTranscriptText } from "./transcript-parse.js";
import { validateTransition } from "./state-machine.js";

describe("mapRecallBotStatus", () => {
  it("maps the normal join -> capture -> end sequence", () => {
    expect(mapRecallBotStatus("joining_call")?.meetingStatus).toBe("JOINING");
    expect(mapRecallBotStatus("in_waiting_room")?.botStatus).toBe("WAITING_FOR_ADMISSION");
    expect(mapRecallBotStatus("in_call_recording")?.meetingStatus).toBe("RECORDING");
    expect(mapRecallBotStatus("call_ended", "call_ended_by_host")?.meetingStatus).toBe("PROCESSING");
  });

  it("treats 'never admitted' endings as capture failures with a readable reason", () => {
    const r = mapRecallBotStatus("call_ended", "timeout_exceeded_waiting_room");
    expect(r?.meetingStatus).toBe("FAILED");
    expect(r?.failureReason).toMatch(/never admitted/);
  });

  it("maps fatal errors, falling back to the raw sub_code", () => {
    expect(mapRecallBotStatus("fatal", "meeting_not_found")?.failureReason).toMatch(/invalid/);
    expect(mapRecallBotStatus("fatal", "something_new")?.failureReason).toContain("something_new");
  });

  it("ignores codes it doesn't know", () => {
    expect(mapRecallBotStatus("breakout_room_entered")).toBeNull();
  });

  it("every meeting status it emits is reachable from SCHEDULED via the state machine", () => {
    // joining -> waiting -> recording -> processing must all be legal edges.
    expect(validateTransition("SCHEDULED", "JOINING").ok).toBe(true);
    expect(validateTransition("JOINING", "WAITING_FOR_ADMISSION").ok).toBe(true);
    expect(validateTransition("WAITING_FOR_ADMISSION", "RECORDING").ok).toBe(true);
    expect(validateTransition("RECORDING", "PROCESSING").ok).toBe(true);
    expect(validateTransition("WAITING_FOR_ADMISSION", "FAILED").ok).toBe(true);
  });
});

describe("recallTranscriptToSegments", () => {
  it("turns speaker turns into segments with millisecond offsets", () => {
    const { segments, language } = recallTranscriptToSegments([
      {
        participant: { id: 1, name: "Jane Doe" },
        language_code: "en",
        words: [
          { text: "Hello", start_timestamp: { relative: 1.25 }, end_timestamp: { relative: 1.8 } },
          { text: "everyone", start_timestamp: { relative: 1.9 }, end_timestamp: { relative: 2.5 } },
        ],
      },
      { participant: { name: "" }, words: [] },
    ]);
    expect(language).toBe("en");
    expect(segments).toEqual([{ speakerLabel: "Jane Doe", startMs: 1250, endMs: 2500, text: "Hello everyone" }]);
  });
});

describe("parseTranscriptText", () => {
  it("parses a Teams VTT with voice tags and merges consecutive cues", () => {
    const vtt = [
      "WEBVTT",
      "",
      "a1/1-0",
      "00:00:01.000 --> 00:00:03.000",
      "<v Jane Doe>We need delta migration.</v>",
      "",
      "a1/2-0",
      "00:00:03.500 --> 00:00:05.000",
      "<v Jane Doe>And private channels.</v>",
      "",
      "00:00:06.000 --> 00:00:08.000",
      "<v Vignesh T>Both are supported.</v>",
    ].join("\n");
    expect(parseTranscriptText(vtt)).toEqual([
      { speakerLabel: "Jane Doe", startMs: 1000, endMs: 5000, text: "We need delta migration. And private channels." },
      { speakerLabel: "Vignesh T", startMs: 6000, endMs: 8000, text: "Both are supported." },
    ]);
  });

  it("parses SRT with 'Speaker:' prefixes", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nJane: Hi\n\n2\n00:00:02,500 --> 00:00:04,000\nBob: Hello";
    const segments = parseTranscriptText(srt);
    expect(segments.map((s) => s.speakerLabel)).toEqual(["Jane", "Bob"]);
  });

  it("parses pasted plain text, folding unprefixed lines into the previous speaker", () => {
    const segments = parseTranscriptText("Jane: We have 2,000 users.\nMost are in the US.\n[00:05:10] Bob: Got it.");
    expect(segments).toEqual([
      { speakerLabel: "Jane", startMs: 0, endMs: 0, text: "We have 2,000 users. Most are in the US." },
      { speakerLabel: "Bob", startMs: 310_000, endMs: 310_000, text: "Got it." },
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseTranscriptText("  \n ")).toEqual([]);
  });
});
