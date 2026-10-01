import type { EventSource, MeetingSessionStatus, Prisma, PrismaClient } from "@prisma/client";
import { validateTransition } from "@meeting-assistant/shared";

export interface ApplyTransitionInput {
  meetingSessionId: string;
  toStatus: MeetingSessionStatus;
  source: EventSource;
  message?: string;
  metadata?: Record<string, unknown>;
  /**
   * Uniquely identifies the event that CAUSED this transition (e.g. a Zoom
   * webhook event id, or `${queueName}:${jobId}`). Combined with a unique
   * (meetingSessionId, idempotencyKey) DB constraint, this is what makes
   * retried webhook deliveries and worker restarts safe to replay.
   */
  idempotencyKey?: string;
  /** Additional columns to set alongside the status change, e.g. startedAt, endedAt, failureReason. */
  extraData?: Prisma.MeetingSessionUpdateInput;
}

export type ApplyTransitionResult =
  | { ok: true; idempotentNoop: boolean }
  | { ok: false; reason: string };

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * The single place that mutates MeetingSession.status. Both the web app
 * (user-initiated cancel) and the worker (webhook-driven / scheduled
 * lifecycle jobs) call this instead of writing to the row directly, so the
 * state machine and idempotency guarantees can't be bypassed.
 */
export async function applyMeetingTransition(
  prisma: PrismaClient,
  input: ApplyTransitionInput,
): Promise<ApplyTransitionResult> {
  const meeting = await prisma.meetingSession.findUnique({
    where: { id: input.meetingSessionId },
    select: { status: true },
  });
  if (!meeting) {
    return { ok: false, reason: `MeetingSession ${input.meetingSessionId} not found` };
  }

  const transition = validateTransition(meeting.status, input.toStatus);
  if (!transition.ok) {
    return { ok: false, reason: transition.reason ?? "Invalid transition" };
  }
  if (transition.idempotentNoop) {
    return { ok: true, idempotentNoop: true };
  }

  try {
    await prisma.$transaction([
      prisma.meetingSession.update({
        where: { id: input.meetingSessionId },
        data: { status: input.toStatus, ...input.extraData },
      }),
      prisma.meetingSessionEvent.create({
        data: {
          meetingSessionId: input.meetingSessionId,
          fromStatus: meeting.status,
          toStatus: input.toStatus,
          source: input.source,
          message: input.message,
          metadataJson: input.metadata as object | undefined,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ]);
    return { ok: true, idempotentNoop: false };
  } catch (err) {
    const isDuplicateEvent =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION;
    if (isDuplicateEvent) {
      // The same idempotencyKey already produced this transition (e.g. Zoom
      // retried the webhook). Treat it as an already-applied success.
      return { ok: true, idempotentNoop: true };
    }
    throw err;
  }
}
