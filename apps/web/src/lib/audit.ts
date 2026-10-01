import { prisma } from "@meeting-assistant/db";

export interface RecordAuditEventInput {
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Fire-and-forget audit log write. Never throws into the caller's request
 * path — an audit log failure should not fail the underlying action.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadataJson: input.metadata as object | undefined,
        ipAddress: input.ipAddress ?? undefined,
      },
    });
  } catch (err) {
    console.error("Failed to record audit event", { action: input.action, err });
  }
}
