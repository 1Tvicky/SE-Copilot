import { prisma, recordApprovalEvent, validateStoredEmail } from "@meeting-assistant/db";
import type { EmailAddress, EmailSendJobData } from "@meeting-assistant/shared";
import { getEmailProvider } from "../integrations/email.js";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";
import { notify } from "../notify.js";

/**
 * Sends one SE-confirmed customer email. Only ever acts on a QUEUED message
 * (the SE's explicit confirmation is what moves it there), re-validates
 * against current data, and is never auto-retried — a duplicate customer
 * email is worse than a visible failure the SE can retry deliberately.
 */
export async function processEmailSend(job: JobContext<EmailSendJobData>): Promise<void> {
  const { emailMessageId } = job.data;
  const log = logger.child({ emailMessageId });

  // Claim atomically so two workers can't both send it.
  const claimed = await prisma.emailMessage.updateMany({ where: { id: emailMessageId, status: "QUEUED" }, data: { status: "SENDING" } });
  if (claimed.count === 0) {
    log.info("Email is not QUEUED; nothing to send");
    return;
  }
  const email = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });

  const fail = async (reason: string) => {
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id: email.id }, data: { status: "FAILED", failureReason: reason.slice(0, 2000) } });
      await recordApprovalEvent(tx, {
        contentType: "CUSTOMER_EMAIL",
        contentId: email.id,
        meetingSessionId: email.meetingSessionId,
        action: "SEND_FAILED",
        actorUserId: email.confirmedById,
        metadata: { reason },
      });
    });
    if (email.meetingSessionId) void notify(email.meetingSessionId, "EMAIL_FAILED", `The customer follow-up was not sent: ${reason}`);
    log.error({ reason }, "Customer email failed");
  };

  const validation = await validateStoredEmail(prisma, email.id);
  if (!validation || !validation.ok) {
    await fail(`Pre-send validation failed: ${validation?.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ") ?? "email no longer linked to a meeting/MOM"}`);
    return;
  }

  const provider = getEmailProvider();
  if (!provider.isConfigured()) {
    await fail("No email provider is configured (Microsoft Graph credentials missing).");
    return;
  }

  // Reply on the original invitation thread when the invite is in the sending mailbox.
  let replyToMessageId = email.replyToMessageId;
  if (!replyToMessageId && email.meetingSessionId) {
    const meeting = await prisma.meetingSession.findUnique({ where: { id: email.meetingSessionId }, select: { name: true, iCalUId: true } });
    if (meeting) {
      replyToMessageId = await provider.findInvitationMessage(email.senderMailbox, { subject: meeting.name, iCalUId: meeting.iCalUId });
      if (replyToMessageId) await prisma.emailMessage.update({ where: { id: email.id }, data: { replyToMessageId } });
    }
  }

  try {
    const result = await provider.send({
      senderMailbox: email.senderMailbox,
      from: { address: email.fromAddress, name: email.fromName },
      to: email.toJson as unknown as EmailAddress[],
      cc: email.ccJson as unknown as EmailAddress[],
      subject: email.subject,
      html: email.bodyHtml,
      replyToMessageId,
    });
    const sentAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id: email.id }, data: { status: "SENT", sentAt, providerMessageId: result.providerMessageId } });
      if (email.momId) await tx.mom.update({ where: { id: email.momId }, data: { status: "SENT", sentAt } });
      await recordApprovalEvent(tx, {
        contentType: "CUSTOMER_EMAIL",
        contentId: email.id,
        meetingSessionId: email.meetingSessionId,
        action: "SENT",
        actorUserId: email.confirmedById,
        snapshot: email.bodyText,
        metadata: { provider: provider.key, providerMessageId: result.providerMessageId, threaded: result.threaded, from: email.fromAddress },
      });
    });
    if (email.meetingSessionId) void notify(email.meetingSessionId, "EMAIL_SENT", `The MOM was sent to the customer from ${email.fromAddress}.`);
    log.info({ provider: provider.key, threaded: result.threaded }, "Customer email sent");
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
}
