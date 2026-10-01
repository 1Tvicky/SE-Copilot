"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Polling-based "near real time" updates for Server Component pages:
 * periodically re-runs the page's server-side data fetch in place via
 * router.refresh(), without a full page reload or losing scroll position.
 * Not push-based (no WebSocket/SSE) — chosen for how little it adds to the
 * architecture; swap for an SSE stream if sub-second latency ever matters.
 */
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
