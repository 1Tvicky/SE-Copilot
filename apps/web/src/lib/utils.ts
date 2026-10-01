import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatDateTime(date: Date | string, timeZone?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(d);
}

function timeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Start/end of the calendar day containing `date` in `timeZone`, as UTC instants. */
export function zonedDayBounds(timeZone: string, date: Date = new Date()): { start: Date; end: Date } {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const offset = timeZoneOffsetMs(tz, date);
  const local = new Date(date.getTime() + offset);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocal - timeZoneOffsetMs(tz, new Date(startLocal - offset)));
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

export function formatTime(date: Date | string, timeZone?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(d);
  }
}

/** Date only. Action-item due dates are stored as UTC midnight, so they are formatted in UTC. */
export function formatDate(date: Date | string, timeZone = "UTC"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(d);
}

/** Today's date as YYYY-MM-DD in `timeZone` (falls back to UTC for an invalid zone). */
export function localIsoDate(timeZone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** A Date offset from the current request time (negative = in the past). */
export function fromNow(ms: number): Date {
  return new Date(Date.now() + ms);
}
