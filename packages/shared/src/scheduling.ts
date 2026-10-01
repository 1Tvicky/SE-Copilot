/**
 * Pure scheduling math for the delayed lifecycle jobs enqueued per meeting
 * session (see apps/web's POST /api/meetings and apps/worker's
 * meeting-lifecycle processor). Extracted so the timing logic — easy to get
 * off-by-one on — is unit-testable without a queue or a clock mock.
 */
export interface LifecycleDelays {
  /** Milliseconds until the watch-start job should fire (0 if scheduledAt is already in the past). */
  startDelayMs: number;
  /** Milliseconds until the watch-timeout safety-net job should fire. */
  timeoutDelayMs: number;
}

export function computeLifecycleDelays(
  scheduledAt: Date,
  maxDurationMinutes: number,
  graceMinutes: number,
  now: Date = new Date(),
): LifecycleDelays {
  const startDelayMs = Math.max(0, scheduledAt.getTime() - now.getTime());
  const timeoutDelayMs = startDelayMs + (maxDurationMinutes + graceMinutes) * 60_000;
  return { startDelayMs, timeoutDelayMs };
}

/**
 * Whether the attempt currently running is the job's last one. pg-boss counts
 * `retryCount` from 0 on the first attempt and allows `retryLimit` retries, so
 * the final attempt is the one where retryCount has reached retryLimit.
 */
export function isFinalJobAttempt(retryCount: number, retryLimit: number | undefined): boolean {
  const limit = typeof retryLimit === "number" ? retryLimit : 0;
  return retryCount >= limit;
}
