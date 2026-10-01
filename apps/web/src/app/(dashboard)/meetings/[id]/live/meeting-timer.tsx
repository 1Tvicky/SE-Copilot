"use client";

import * as React from "react";

function fmt(ms: number) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Counts down to the scheduled start, then up from the actual (or scheduled) start; frozen once the meeting ended. */
export function MeetingTimer({ startsAt, startedAt, endedAt }: { startsAt: string; startedAt: string | null; endedAt: string | null }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (now === null) return <span className="font-mono text-sm text-muted-foreground">--:--</span>;

  const anchor = new Date(startedAt ?? startsAt).getTime();
  if (endedAt) {
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground" title="Meeting length">
        {fmt(new Date(endedAt).getTime() - anchor)} total
      </span>
    );
  }
  const before = !startedAt && now < anchor;
  return (
    <span className="font-mono text-sm tabular-nums" aria-live="off" title={before ? "Time until start" : "Elapsed"}>
      {before ? `starts in ${fmt(anchor - now)}` : fmt(now - anchor)}
    </span>
  );
}
