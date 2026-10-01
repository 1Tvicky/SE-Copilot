/**
 * Races a promise against a hard deadline. Redis client libraries' own
 * timeout options govern the wire-level command, but not every failure mode
 * (e.g. a connection that never finishes establishing) is guaranteed to
 * respect them — an HTTP handler awaiting a queue op must still bound how
 * long it will wait, so a Redis outage degrades to a fast error instead of
 * a hung request.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "Operation timed out"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
