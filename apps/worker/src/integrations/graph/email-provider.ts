import type { EmailAddress, EmailProvider, OutboundEmail, SentEmailResult } from "@meeting-assistant/shared";
import { graphRequest, isGraphConfigured } from "./client.js";

const recipient = (r: EmailAddress) => ({ emailAddress: { address: r.address, ...(r.name ? { name: r.name } : {}) } });

/**
 * Sends customer follow-ups through Graph as `senderMailbox`. When the
 * visible From (the Team DL) differs, Graph requires the mailbox to hold
 * "Send As" on the DL; Exchange rejects the send otherwise, and we surface
 * that error rather than silently sending from the mailbox instead.
 */
export class GraphEmailProvider implements EmailProvider {
  readonly key = "microsoft-graph";

  isConfigured(): boolean {
    return isGraphConfigured();
  }

  async send(email: OutboundEmail): Promise<SentEmailResult> {
    const mailbox = encodeURIComponent(email.senderMailbox);
    const from =
      email.from.address.toLowerCase() !== email.senderMailbox.toLowerCase() ? { from: recipient(email.from) } : {};

    if (email.replyToMessageId) {
      // Reply on the original invitation thread: createReplyAll gives a draft
      // with the right conversation/threading headers; we then replace its
      // recipients and body with exactly what the SE approved.
      const draft = await graphRequest<{ id: string }>(
        `/users/${mailbox}/messages/${encodeURIComponent(email.replyToMessageId)}/createReplyAll`,
        { method: "POST", body: {} },
      );
      await graphRequest(`/users/${mailbox}/messages/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        body: {
          ...from,
          subject: email.subject,
          toRecipients: email.to.map(recipient),
          ccRecipients: email.cc.map(recipient),
          body: { contentType: "HTML", content: email.html },
        },
      });
      await graphRequest(`/users/${mailbox}/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
      return { providerMessageId: draft.id, threaded: true };
    }

    await graphRequest(`/users/${mailbox}/sendMail`, {
      method: "POST",
      body: {
        message: {
          ...from,
          subject: email.subject,
          toRecipients: email.to.map(recipient),
          ccRecipients: email.cc.map(recipient),
          body: { contentType: "HTML", content: email.html },
        },
        saveToSentItems: true,
      },
    });
    return { providerMessageId: null, threaded: false };
  }

  /**
   * Best effort: the invitation is a meeting-request message in the
   * mailbox's inbox with the event's subject. Returns null if not found,
   * in which case the follow-up goes out as a new "Re:" message.
   */
  async findInvitationMessage(mailbox: string, input: { subject: string; iCalUId: string | null }): Promise<string | null> {
    if (!input.subject.trim()) return null;
    const subject = input.subject.replace(/'/g, "''");
    const params = new URLSearchParams({
      $filter: `subject eq '${subject}'`,
      $select: "id,subject,receivedDateTime",
      $top: "5",
    });
    try {
      const res = await graphRequest<{ value: { id: string; receivedDateTime?: string }[] }>(
        `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?${params.toString()}`,
      );
      const newest = [...res.value].sort((a, b) => (b.receivedDateTime ?? "").localeCompare(a.receivedDateTime ?? ""))[0];
      return newest?.id ?? null;
    } catch {
      return null;
    }
  }

  async testConnection(senderMailbox: string): Promise<{ ok: boolean; message: string }> {
    try {
      await graphRequest(`/users/${encodeURIComponent(senderMailbox)}/mailFolders/inbox?$select=id`);
      return { ok: true, message: "Mailbox is reachable (Send As rights are only verified on the first real send)." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
