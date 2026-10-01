import { emailDomain, isInternalEmail } from "./meeting-rules.js";

export interface EmailAddress {
  address: string;
  name?: string | null;
}

// ---------------------------------------------------------------------------
// Markdown -> HTML (the small subset renderMomMarkdown produces)
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Renders headings (#, ##, ###), "- " bullets (with indented continuation
 * lines), **bold** and paragraphs. Everything is HTML-escaped first, so SE
 * edits can never inject markup into a customer email.
 */
export function markdownToEmailHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p style="margin:0 0 12px">${paragraph.map(inline).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const continuation = /^\s{2,}(\S.*)$/.exec(raw);

    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1]!.length;
      const size = level === 1 ? 20 : level === 2 ? 16 : 14;
      out.push(`<h${level} style="font-size:${size}px;margin:18px 0 8px">${inline(heading[2]!)}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      if (!inList) {
        out.push('<ul style="margin:0 0 12px;padding-left:20px">');
        inList = true;
      }
      out.push(`<li style="margin:0 0 4px">${inline(bullet[1]!)}</li>`);
    } else if (continuation && inList) {
      // Indented line under a bullet: append to the previous <li>.
      const last = out.pop() ?? "";
      out.push(last.replace(/<\/li>$/, `<br>${inline(continuation[1]!)}</li>`));
    } else if (line.trim() === "") {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  closeList();
  return out.join("\n");
}

/** Plain-text alternative: strip markdown emphasis, keep structure. */
export function markdownToPlainText(markdown: string): string {
  return markdown.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,3}\s+/gm, "").trim();
}

// ---------------------------------------------------------------------------
// Customer follow-up email
// ---------------------------------------------------------------------------

export interface FollowUpEmailInput {
  originalSubject: string;
  momMarkdown: string;
  signatureName: string;
  /** Optional extra signature block (plain text, multi-line). */
  signature?: string | null;
}

export function buildFollowUpSubject(originalSubject: string): string {
  const trimmed = originalSubject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function buildFollowUpEmail(input: FollowUpEmailInput): { subject: string; html: string; text: string } {
  const intro = "Hi everyone,\n\nThank you for your time today.\n\nPlease find below the summary of our discussion and the agreed action items.";
  const closing = `Best regards,\n${input.signatureName}${input.signature ? `\n${input.signature}` : ""}`;

  const html = [
    '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2328">',
    `<p style="margin:0 0 12px">Hi everyone,</p>`,
    `<p style="margin:0 0 12px">Thank you for your time today.</p>`,
    `<p style="margin:0 0 12px">Please find below the summary of our discussion and the agreed action items.</p>`,
    '<hr style="border:none;border-top:1px solid #d0d7de;margin:16px 0">',
    markdownToEmailHtml(input.momMarkdown),
    '<hr style="border:none;border-top:1px solid #d0d7de;margin:16px 0">',
    `<p style="margin:0 0 12px">${escapeHtml(closing).replace(/\n/g, "<br>")}</p>`,
    "</div>",
  ].join("\n");

  const text = `${intro}\n\n${markdownToPlainText(input.momMarkdown)}\n\n${closing}\n`;
  return { subject: buildFollowUpSubject(input.originalSubject), html, text };
}

// ---------------------------------------------------------------------------
// Pre-send validation
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

export function isValidEmailAddress(address: string): boolean {
  return EMAIL_PATTERN.test(address.trim());
}

export type ValidationSeverity = "error" | "warning";

export interface EmailValidationIssue {
  severity: ValidationSeverity;
  field: "sender" | "recipients" | "meeting" | "subject" | "content";
  message: string;
}

export interface EmailValidationInput {
  fromAddress: string | null | undefined;
  senderMailbox: string | null | undefined;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  /** Attendee emails of the meeting this follow-up belongs to. */
  meetingParticipantEmails: string[];
  customerDomains: string[];
  internalDomains: string[];
  momStatus: string;
  momApprovedHash: string | null;
  currentMomHash: string;
  momMarkdown: string;
}

export interface EmailValidationResult {
  ok: boolean;
  issues: EmailValidationIssue[];
}

/**
 * Everything that must be true before a customer email may be sent. Errors
 * block the send outright; warnings are shown in the final preview for the SE
 * to consciously accept.
 */
export function validateCustomerEmail(input: EmailValidationInput): EmailValidationResult {
  const issues: EmailValidationIssue[] = [];
  const err = (field: EmailValidationIssue["field"], message: string) => issues.push({ severity: "error", field, message });
  const warn = (field: EmailValidationIssue["field"], message: string) => issues.push({ severity: "warning", field, message });

  if (!input.fromAddress || !isValidEmailAddress(input.fromAddress)) err("sender", "No valid Team DL / sender address is configured.");
  if (!input.senderMailbox || !isValidEmailAddress(input.senderMailbox)) err("sender", "No sending mailbox is configured.");

  const all = [...input.to, ...input.cc];
  if (input.to.length === 0) err("recipients", "Add at least one recipient.");
  const seen = new Set<string>();
  const participants = new Set(input.meetingParticipantEmails.map((e) => e.toLowerCase()));
  for (const r of all) {
    const address = r.address.trim().toLowerCase();
    if (!isValidEmailAddress(address)) {
      err("recipients", `"${r.address}" is not a valid email address.`);
      continue;
    }
    if (seen.has(address)) warn("recipients", `${address} is listed more than once.`);
    seen.add(address);
    if (!participants.has(address)) warn("recipients", `${address} was not a participant in this meeting.`);
    const domain = emailDomain(address);
    if (
      !isInternalEmail(address, input.internalDomains) &&
      input.customerDomains.length > 0 &&
      !input.customerDomains.includes(domain)
    ) {
      warn("recipients", `${address} is outside both your organization and this customer's domains (${input.customerDomains.join(", ")}).`);
    }
  }
  if (input.to.length > 0 && input.to.every((r) => isInternalEmail(r.address, input.internalDomains))) {
    warn("recipients", "Every recipient is internal — no customer participant is on the To line.");
  }

  if (input.meetingParticipantEmails.length === 0) warn("meeting", "This meeting has no recorded participants to check recipients against.");

  if (!input.subject.trim()) err("subject", "Subject is empty.");

  if (input.momStatus !== "APPROVED") err("content", "The MOM must be approved before it can be sent.");
  else if (!input.momApprovedHash || input.momApprovedHash !== input.currentMomHash) {
    err("content", "The MOM changed after it was approved. Re-approve it before sending.");
  }
  if (!input.momMarkdown.trim()) err("content", "The MOM is empty.");

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
