import { createHash } from "node:crypto";
import type { ApprovalAction, ApprovalContentType, Prisma, PrismaClient } from "@prisma/client";

/** Content fingerprint used to prove the sent MOM is byte-for-byte the approved one. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface RecordApprovalEventInput {
  contentType: ApprovalContentType;
  contentId: string;
  meetingSessionId?: string | null;
  action: ApprovalAction;
  actorUserId?: string | null;
  snapshot?: string | null;
  metadata?: Record<string, unknown>;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Appends to the approval trail. Unlike the general audit log this is NOT
 * fire-and-forget: it runs inside the same transaction as the approval /
 * send it describes, so an approval can never exist without its record.
 */
export function recordApprovalEvent(db: Db, input: RecordApprovalEventInput) {
  return db.approvalEvent.create({
    data: {
      contentType: input.contentType,
      contentId: input.contentId,
      meetingSessionId: input.meetingSessionId ?? null,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      snapshot: input.snapshot ?? null,
      metadataJson: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
