export const MEETING_SESSION_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PREPARING",
  "JOINING",
  "WAITING_FOR_ADMISSION",
  "ACTIVE",
  "RECORDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type MeetingSessionStatus = (typeof MEETING_SESSION_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<MeetingSessionStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export function isTerminalStatus(status: MeetingSessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
