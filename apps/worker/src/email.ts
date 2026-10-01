import { Resend } from "resend";
import { logger } from "./logger.js";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const FROM = process.env.EMAIL_FROM ?? "Meeting Assistant <notifications@example.com>";

/** Mirrors apps/web/src/lib/email.ts — kept separate since the worker can't import from the web app. */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  if (!resend) {
    logger.warn({ to: input.to, subject: input.subject }, "RESEND_API_KEY not set — email not sent");
    return { delivered: false };
  }

  const result = await resend.emails.send({ from: FROM, to: input.to, subject: input.subject, html: input.html });
  return { delivered: !result.error };
}
