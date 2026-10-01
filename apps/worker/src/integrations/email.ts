import type { EmailProvider, OutboundEmail, SentEmailResult } from "@meeting-assistant/shared";
import { GraphEmailProvider } from "./graph/email-provider.js";
import { logger } from "../logger.js";

/** Marker prefix on providerMessageId for messages that were NOT delivered. */
export const DEV_OUTBOX_PREFIX = "dev-outbox:";

/**
 * Local-development stand-in that records the email instead of sending it.
 * Refuses to load in production, and every "sent" message carries a
 * providerMessageId starting with DEV_OUTBOX_PREFIX so the UI can label it
 * "not delivered".
 */
class DevOutboxEmailProvider implements EmailProvider {
  readonly key = "dev-outbox";

  isConfigured(): boolean {
    return process.env.NODE_ENV !== "production";
  }

  async send(email: OutboundEmail): Promise<SentEmailResult> {
    if (process.env.NODE_ENV === "production") throw new Error("The dev outbox email provider cannot be used in production");
    logger.warn(
      { from: email.from.address, to: email.to.map((t) => t.address), subject: email.subject },
      "DEV OUTBOX: email recorded, NOT delivered (EMAIL_PROVIDER=dev-outbox)",
    );
    return { providerMessageId: `${DEV_OUTBOX_PREFIX}${crypto.randomUUID()}`, threaded: false };
  }

  async findInvitationMessage(): Promise<string | null> {
    return null;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Dev outbox: emails are recorded locally and never delivered." };
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider = process.env.EMAIL_PROVIDER === "dev-outbox" ? new DevOutboxEmailProvider() : new GraphEmailProvider();
  }
  return provider;
}
