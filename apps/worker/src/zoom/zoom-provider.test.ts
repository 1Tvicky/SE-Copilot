import { describe, expect, it } from "vitest";
import { extractMeetingIdFromUrl } from "./zoom-provider.js";

describe("extractMeetingIdFromUrl", () => {
  it("extracts the id from a /j/ join URL", () => {
    expect(extractMeetingIdFromUrl("https://us02web.zoom.us/j/1234567890?pwd=abc")).toBe("1234567890");
  });

  it("extracts the id from a /s/ URL", () => {
    expect(extractMeetingIdFromUrl("https://zoom.us/s/9876543210")).toBe("9876543210");
  });

  it("returns null for a URL with no recognizable meeting id", () => {
    expect(extractMeetingIdFromUrl("https://zoom.us/meeting/lookup")).toBeNull();
  });

  it("returns null for a non-Zoom URL", () => {
    expect(extractMeetingIdFromUrl("https://meet.google.com/abc-defg-hij")).toBeNull();
  });
});
