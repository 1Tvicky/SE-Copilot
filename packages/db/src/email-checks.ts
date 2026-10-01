import type { PrismaClient } from "@prisma/client";
import { validateCustomerEmail, type EmailAddress, type EmailValidationResult } from "@meeting-assistant/shared";
import { contentHash } from "./approvals.js";

/**
 * Re-derives the pre-send validation for a stored email from the current
 * database state (team config, meeting participants, MOM approval). Both the
 * preview the SE confirms and the worker's last check before sending call
 * this, so a stale preview can never authorize a send.
 */
export async function validateStoredEmail(prisma: PrismaClient, emailMessageId: string): Promise<EmailValidationResult | null> {
  const email = await prisma.emailMessage.findUnique({
    where: { id: emailMessageId },
    include: {
      team: true,
      mom: true,
      meetingSession: { include: { participants: true, customer: true } },
    },
  });
  if (!email || !email.mom || !email.meetingSession) return null;

  const to = email.toJson as unknown as EmailAddress[];
  const cc = email.ccJson as unknown as EmailAddress[];
  return validateCustomerEmail({
    fromAddress: email.fromAddress,
    senderMailbox: email.senderMailbox,
    to,
    cc,
    subject: email.subject,
    meetingParticipantEmails: email.meetingSession.participants.map((p) => p.email),
    customerDomains: email.meetingSession.customer?.domains ?? [],
    internalDomains: email.team?.internalDomains ?? [],
    momStatus: email.mom.status,
    momApprovedHash: email.mom.approvedHash,
    // The email body was rendered from a specific MOM; both must still match the approval.
    currentMomHash: email.momHash === contentHash(email.mom.markdown) ? contentHash(email.mom.markdown) : "mismatch",
    momMarkdown: email.mom.markdown,
  });
}
