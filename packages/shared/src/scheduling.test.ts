import { describe, expect, it } from "vitest";
import { computeLifecycleDelays, isFinalJobAttempt } from "./scheduling.js";

describe("computeLifecycleDelays", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("computes a positive start delay for a future meeting", () => {
    const scheduledAt = new Date("2026-01-01T01:00:00.000Z"); // +1h
    const { startDelayMs } = computeLifecycleDelays(scheduledAt, 60, 30, now);
    expect(startDelayMs).toBe(60 * 60 * 1000);
  });

  it("clamps the start delay to 0 for a meeting scheduled in the past", () => {
    const scheduledAt = new Date("2025-12-31T23:00:00.000Z"); // -1h
    const { startDelayMs } = computeLifecycleDelays(scheduledAt, 60, 30, now);
    expect(startDelayMs).toBe(0);
  });

  it("adds max duration plus grace period on top of the start delay for the timeout", () => {
    const scheduledAt = new Date("2026-01-01T01:00:00.000Z"); // +1h
    const { startDelayMs, timeoutDelayMs } = computeLifecycleDelays(scheduledAt, 60, 30, now);
    expect(timeoutDelayMs).toBe(startDelayMs + 90 * 60 * 1000);
  });

  it("still adds the full duration+grace window even when start delay clamped to 0", () => {
    const scheduledAt = new Date("2025-12-31T23:00:00.000Z");
    const { timeoutDelayMs } = computeLifecycleDelays(scheduledAt, 45, 15, now);
    expect(timeoutDelayMs).toBe(60 * 60 * 1000);
  });
});

describe("isFinalJobAttempt (pg-boss retryCount/retryLimit)", () => {
  it("is not final while retries remain", () => {
    expect(isFinalJobAttempt(0, 2)).toBe(false);
    expect(isFinalJobAttempt(1, 2)).toBe(false);
  });

  it("is final once retryCount reaches retryLimit", () => {
    expect(isFinalJobAttempt(2, 2)).toBe(true);
  });

  it("treats a missing retryLimit as no retries", () => {
    expect(isFinalJobAttempt(0, undefined)).toBe(true);
  });
});
