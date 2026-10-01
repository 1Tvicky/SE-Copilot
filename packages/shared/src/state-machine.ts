import { isTerminalStatus, type MeetingSessionStatus } from "./status.js";

/**
 * Explicit transition table. Only edges listed here are valid; everything else
 * is rejected. Kept as a single source of truth so the dashboard, worker, and
 * tests all agree on what "valid" means.
 */
const TRANSITIONS: Record<MeetingSessionStatus, readonly MeetingSessionStatus[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  // Every pre-capture status can go straight to PROCESSING: that is the
  // "capture unavailable, the SE supplied a transcript/notes instead" path.
  SCHEDULED: ["PREPARING", "JOINING", "PROCESSING", "CANCELLED", "FAILED"],
  PREPARING: ["JOINING", "PROCESSING", "FAILED", "CANCELLED"],
  JOINING: ["WAITING_FOR_ADMISSION", "ACTIVE", "RECORDING", "PROCESSING", "FAILED", "CANCELLED"],
  WAITING_FOR_ADMISSION: ["ACTIVE", "RECORDING", "PROCESSING", "FAILED", "CANCELLED"],
  ACTIVE: ["RECORDING", "PROCESSING", "FAILED", "CANCELLED"],
  RECORDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  // FAILED is terminal for automated capture, but the SE can still recover the
  // meeting by uploading/pasting a transcript or entering notes. That is the
  // only edge out of it.
  FAILED: ["PROCESSING"],
  CANCELLED: [],
};

export interface StateTransitionResult {
  ok: boolean;
  /** True when `to` already equals `from` — caller should treat as a no-op success, not an error. */
  idempotentNoop: boolean;
  reason?: string;
}

/**
 * Pure validation: does not touch the database. Callers are responsible for
 * making the actual persisted transition idempotent (e.g. a unique
 * (sessionId, toStatus) constraint on the event table) so that worker
 * restarts or duplicate webhook deliveries cannot double-apply a transition.
 */
export function validateTransition(
  from: MeetingSessionStatus,
  to: MeetingSessionStatus,
): StateTransitionResult {
  if (from === to) {
    return { ok: true, idempotentNoop: true };
  }

  const allowed = TRANSITIONS[from];
  if (allowed.length === 0) {
    return {
      ok: false,
      idempotentNoop: false,
      reason: `Cannot transition out of terminal status ${from}`,
    };
  }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      idempotentNoop: false,
      reason: `Transition ${from} -> ${to} is not allowed. Allowed: ${allowed.join(", ") || "(none, terminal)"}`,
    };
  }

  return { ok: true, idempotentNoop: false };
}

export function getAllowedTransitions(from: MeetingSessionStatus): readonly MeetingSessionStatus[] {
  return TRANSITIONS[from];
}

export interface FailureContext {
  reason: string;
  code?: string;
  occurredAt: Date;
}

/** Every non-terminal status can fail; this just documents the intent at call sites. */
export function canFail(status: MeetingSessionStatus): boolean {
  return !isTerminalStatus(status) && TRANSITIONS[status].includes("FAILED");
}

export function canCancel(status: MeetingSessionStatus): boolean {
  return !isTerminalStatus(status) && TRANSITIONS[status].includes("CANCELLED");
}
