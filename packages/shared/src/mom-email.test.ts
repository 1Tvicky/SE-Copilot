import { describe, expect, it } from "vitest";
import { meetingAnalysisContentSchema, NOT_SPECIFIED, parseIsoDateOnly, renderMomMarkdown, type MeetingAnalysisContent } from "./analysis.js";
import { buildFollowUpEmail, buildFollowUpSubject, markdownToEmailHtml, validateCustomerEmail, type EmailValidationInput } from "./email.js";

const analysis: MeetingAnalysisContent = {
  executiveSummary: "Contoso wants to move 2,000 Slack users to Teams.",
  meetingObjective: "Scope the Slack to Teams migration.",
  customerRequirements: [{ requirement: "Preserve channel history", kind: "technical" }],
  technicalDiscussion: [{ topic: "Private channels", details: "Mapped to Teams private channels." }],
  questions: [
    { question: "Is delta migration supported?", askedBy: "Jane", answer: "Yes, via incremental passes." },
    { question: "Can DMs be migrated?", askedBy: null, answer: null },
  ],
  decisions: [{ decision: "Run a POC with 50 users", context: null }],
  concerns: ["Downtime during cutover"],
  risks: [{ risk: "Tight timeline", impact: "Could slip go-live" }],
  actionItems: [
    { description: "Share POC plan", owner: "CloudFuze SE", dueDate: "2026-10-08", dueDateText: "next week", priority: "high" },
    { description: "Provide admin access", owner: null, dueDate: null, dueDateText: null, priority: "medium" },
  ],
  openQuestions: ["Licensing for guest users"],
  nextSteps: ["POC kickoff"],
  interestingTopics: [{ topic: "Permission parity", whyInteresting: "Comes up in most migrations" }],
};

const info = {
  title: "Contoso | Migration discovery",
  customerName: "Contoso",
  dateText: "Oct 1, 2026, 10:00 AM",
  participants: [{ name: "Jane", email: "jane@contoso.com" }],
  meetingTypeLabel: "Migration discussion",
};

describe("renderMomMarkdown", () => {
  const md = renderMomMarkdown(info, analysis);

  it("follows the MOM section structure", () => {
    const headings = md.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual([
      "## Meeting Information",
      "## Meeting Objective",
      "## Discussion Summary",
      "## Customer Requirements",
      "## Technical Discussion",
      "## Questions & Answers",
      "## Decisions",
      "## Action Items",
      "## Open Questions",
      "## Next Steps",
    ]);
  });

  it("never leaks internal-only sections into the customer MOM", () => {
    expect(md).not.toContain("Tight timeline");
    expect(md).not.toContain("Permission parity");
  });

  it("marks unanswered questions and unowned actions instead of inventing them", () => {
    expect(md).toContain("**A:** To be followed up.");
    expect(md).toContain("Provide admin access — **Owner:** TBD");
    expect(md).toContain("**Due:** 2026-10-08");
  });

  it('uses "Not specified in the meeting." for empty sections', () => {
    const empty = renderMomMarkdown(
      { ...info, customerName: null },
      { ...analysis, customerRequirements: [], nextSteps: [], technicalDiscussion: [] },
    );
    expect(empty).toContain(`- **Customer:** ${NOT_SPECIFIED}`);
    expect(empty.match(new RegExp(NOT_SPECIFIED.replace(".", "\\."), "g"))?.length).toBeGreaterThanOrEqual(3);
  });

  it("the analysis schema accepts the fixture (structured-output contract)", () => {
    expect(meetingAnalysisContentSchema.safeParse(analysis).success).toBe(true);
  });
});

describe("parseIsoDateOnly", () => {
  it("accepts real dates only", () => {
    expect(parseIsoDateOnly("2026-10-08")?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(parseIsoDateOnly("2026-02-30")).toBeNull();
    expect(parseIsoDateOnly("next Friday")).toBeNull();
  });
});

describe("markdownToEmailHtml", () => {
  it("escapes HTML so SE edits cannot inject markup", () => {
    const html = markdownToEmailHtml("Hello <script>alert(1)</script> **bold**");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders headings, bullets and bullet continuation lines", () => {
    const html = markdownToEmailHtml("## Q&A\n\n- **Q:** One?\n  **A:** Yes.");
    expect(html).toContain("<h2");
    expect(html).toContain("Q&amp;A");
    expect(html).toContain("<li style=\"margin:0 0 4px\"><strong>Q:</strong> One?<br><strong>A:</strong> Yes.</li>");
  });
});

describe("buildFollowUpEmail", () => {
  it("replies on the original subject", () => {
    expect(buildFollowUpSubject("Contoso | Discovery")).toBe("Re: Contoso | Discovery");
    expect(buildFollowUpSubject("RE: Contoso | Discovery")).toBe("RE: Contoso | Discovery");
  });

  it("wraps the approved MOM in the standard greeting and signature", () => {
    const email = buildFollowUpEmail({ originalSubject: "Discovery", momMarkdown: "# Minutes of Meeting", signatureName: "Solution Engineering Team" });
    expect(email.text).toMatch(/^Hi everyone,/);
    expect(email.text).toContain("Best regards,\nSolution Engineering Team");
    expect(email.html).toContain("Minutes of Meeting");
  });
});

describe("validateCustomerEmail", () => {
  const ok: EmailValidationInput = {
    fromAddress: "se-team@cloudfuze.com",
    senderMailbox: "se-copilot@cloudfuze.com",
    to: [{ address: "jane@contoso.com" }],
    cc: [{ address: "vignesh@cloudfuze.com" }],
    subject: "Re: Discovery",
    meetingParticipantEmails: ["jane@contoso.com", "vignesh@cloudfuze.com"],
    customerDomains: ["contoso.com"],
    internalDomains: ["cloudfuze.com"],
    momStatus: "APPROVED",
    momApprovedHash: "abc",
    currentMomHash: "abc",
    momMarkdown: "# MOM",
  };

  it("passes a clean, approved email", () => {
    expect(validateCustomerEmail(ok)).toEqual({ ok: true, issues: [] });
  });

  it("blocks sending an unapproved MOM or one edited after approval", () => {
    expect(validateCustomerEmail({ ...ok, momStatus: "AWAITING_APPROVAL" }).ok).toBe(false);
    const edited = validateCustomerEmail({ ...ok, currentMomHash: "changed" });
    expect(edited.ok).toBe(false);
    expect(edited.issues[0]?.message).toMatch(/changed after it was approved/);
  });

  it("blocks a missing sender and empty recipients", () => {
    expect(validateCustomerEmail({ ...ok, fromAddress: null }).ok).toBe(false);
    expect(validateCustomerEmail({ ...ok, to: [] }).ok).toBe(false);
  });

  it("warns (but does not block) on recipients outside the meeting / customer", () => {
    const r = validateCustomerEmail({ ...ok, to: [{ address: "someone@fabrikam.com" }] });
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/not a participant/);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/outside both your organization/);
  });

  it("warns when no customer is on the To line", () => {
    const r = validateCustomerEmail({ ...ok, to: [{ address: "vignesh@cloudfuze.com" }], cc: [] });
    expect(r.issues.some((i) => /Every recipient is internal/.test(i.message))).toBe(true);
  });
});
