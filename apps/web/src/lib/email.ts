import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const FROM = process.env.EMAIL_FROM ?? "Meeting Assistant <notifications@example.com>";

/**
 * Thin email-provider abstraction so notification code (password reset,
 * meeting lifecycle emails) doesn't depend on Resend directly. Swap this
 * implementation to change providers without touching callers.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  if (!resend) {
    // No provider configured (e.g. local dev without RESEND_API_KEY). Log
    // instead of silently succeeding, so it's obvious nothing was actually sent.
    console.warn("[email] RESEND_API_KEY not set — email not sent. Would have sent:", {
      to: input.to,
      subject: input.subject,
    });
    return { delivered: false };
  }

  const result = await resend.emails.send({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });

  return { delivered: !result.error };
}
