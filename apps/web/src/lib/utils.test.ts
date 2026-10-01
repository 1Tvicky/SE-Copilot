import { describe, expect, it } from "vitest";
import { cn, formatDuration, zonedDayBounds } from "./utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false && "hidden", "font-medium")).toBe("text-sm font-medium");
  });
});

describe("formatDuration", () => {
  it("renders minutes under an hour as Nm", () => {
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(59)).toBe("59m");
  });

  it("renders exact hours as Nh", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
  });

  it("renders mixed hours and minutes as Nh Mm", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(150)).toBe("2h 30m");
  });
});

describe("zonedDayBounds", () => {
  it("returns the local calendar day for a positive-offset zone (IST, +05:30)", () => {
    const { start, end } = zonedDayBounds("Asia/Kolkata", new Date("2026-10-01T20:00:00Z")); // 01:30 Oct 2 IST
    expect(start.toISOString()).toBe("2026-10-01T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-02T18:30:00.000Z");
  });

  it("handles negative offsets (New York, EDT)", () => {
    const { start } = zonedDayBounds("America/New_York", new Date("2026-10-01T02:00:00Z")); // 22:00 Sep 30 EDT
    expect(start.toISOString()).toBe("2026-09-30T04:00:00.000Z");
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(zonedDayBounds("Not/AZone", new Date("2026-10-01T12:00:00Z")).start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
