import { describe, expect, it } from "vitest";
import { formatMeetingDate, formatOffset } from "./meeting-analysis.js";

describe("formatMeetingDate", () => {
  it("formats in the team timezone with an explicit zone label", () => {
    expect(formatMeetingDate(new Date("2026-10-01T19:48:00Z"), "Asia/Kolkata")).toBe("October 2, 2026 at 1:18 AM GMT+5:30");
  });

  it("falls back to UTC (never an ISO string) for an invalid zone", () => {
    expect(formatMeetingDate(new Date("2026-10-01T19:48:00Z"), "Not/AZone")).toBe("October 1, 2026 at 7:48 PM UTC");
  });
});

describe("formatOffset", () => {
  it("renders m:ss under an hour and h:mm:ss above", () => {
    expect(formatOffset(65_000)).toBe("1:05");
    expect(formatOffset(3_725_000)).toBe("1:02:05");
  });
});
