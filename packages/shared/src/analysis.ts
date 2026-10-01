import * as z from "zod/v4";

/** The phrase every generated artifact uses when the meeting did not say something. */
export const NOT_SPECIFIED = "Not specified in the meeting.";

/**
 * Structured meeting intelligence produced by the AI provider. Used both as
 * the structured-output schema sent to Claude and to validate what comes
 * back. Every field is required and "unknown" is an explicit null / empty
 * list, so the model never has to invent a value to satisfy the schema.
 */
export const meetingAnalysisContentSchema = z.object({
  executiveSummary: z.string().describe("3-5 sentence overview of what was actually discussed."),
  meetingObjective: z
    .string()
    .describe(`Purpose of the meeting as stated or clearly implied by the participants. "${NOT_SPECIFIED}" if not stated.`),
  customerRequirements: z.array(
    z.object({
      requirement: z.string(),
      kind: z.enum(["business", "technical"]),
    }),
  ),
  technicalDiscussion: z.array(z.object({ topic: z.string(), details: z.string() })),
  questions: z
    .array(
      z.object({
        question: z.string(),
        askedBy: z.string().nullable().describe("Name of who asked, only if identifiable from the transcript/notes."),
        answer: z.string().nullable().describe("The answer actually given in the meeting, or null if it was not answered."),
      }),
    )
    .describe("Questions raised in the meeting, with the answer given (if any)."),
  decisions: z.array(z.object({ decision: z.string(), context: z.string().nullable() })),
  concerns: z.array(z.string()).describe("Concerns the customer raised."),
  risks: z.array(z.object({ risk: z.string(), impact: z.string().nullable() })).describe("Potential delivery/deal risks (internal only)."),
  actionItems: z.array(
    z.object({
      description: z.string(),
      owner: z.string().nullable().describe("Person or party who agreed to do it, only if stated."),
      dueDate: z.string().nullable().describe("YYYY-MM-DD, only if an explicit date was stated or is unambiguous from the meeting date."),
      dueDateText: z.string().nullable().describe("The due date as said in the meeting, e.g. 'by next Friday', or null."),
      priority: z.enum(["low", "medium", "high"]),
    }),
  ),
  openQuestions: z.array(z.string()).describe("Questions that remain unresolved at the end of the meeting."),
  nextSteps: z.array(z.string()).describe("Only next steps that were actually agreed or proposed in the meeting."),
  interestingTopics: z
    .array(z.object({ topic: z.string(), whyInteresting: z.string() }))
    .describe("Reusable learnings worth sharing with the wider organization (internal only)."),
});

export type MeetingAnalysisContent = z.infer<typeof meetingAnalysisContentSchema>;

export interface MomMeetingInfo {
  title: string;
  customerName: string | null;
  /** Already formatted for display in the team's timezone. */
  dateText: string;
  participants: { name: string | null; email: string }[];
  meetingTypeLabel: string;
}

function bullets(items: string[], empty = NOT_SPECIFIED): string {
  return items.length === 0 ? `- ${empty}` : items.map((i) => `- ${i}`).join("\n");
}

/**
 * Deterministically renders the customer-facing Minutes of Meeting from a
 * validated analysis. No second AI call: the MOM can only contain what the
 * analysis contains, and internal-only sections (risks, interesting topics,
 * internal concerns) are never included.
 */
export function renderMomMarkdown(info: MomMeetingInfo, a: MeetingAnalysisContent): string {
  const participants =
    info.participants.length === 0
      ? NOT_SPECIFIED
      : info.participants.map((p) => (p.name ? `${p.name} (${p.email})` : p.email)).join(", ");

  const qa =
    a.questions.length === 0
      ? `- ${NOT_SPECIFIED}`
      : a.questions.map((q) => `- **Q:** ${q.question}\n  **A:** ${q.answer ?? "To be followed up."}`).join("\n");

  const actions =
    a.actionItems.length === 0
      ? "- No action items were agreed."
      : a.actionItems
          .map((ai) => {
            const due = ai.dueDate ?? ai.dueDateText;
            return `- ${ai.description} — **Owner:** ${ai.owner ?? "TBD"}${due ? ` — **Due:** ${due}` : ""}`;
          })
          .join("\n");

  return [
    "# Minutes of Meeting",
    "",
    "## Meeting Information",
    "",
    `- **Meeting:** ${info.title}`,
    `- **Customer:** ${info.customerName ?? NOT_SPECIFIED}`,
    `- **Date:** ${info.dateText}`,
    `- **Participants:** ${participants}`,
    `- **Meeting Type:** ${info.meetingTypeLabel}`,
    "",
    "## Meeting Objective",
    "",
    a.meetingObjective || NOT_SPECIFIED,
    "",
    "## Discussion Summary",
    "",
    a.executiveSummary || NOT_SPECIFIED,
    "",
    "## Customer Requirements",
    "",
    bullets(a.customerRequirements.map((r) => r.requirement)),
    "",
    "## Technical Discussion",
    "",
    bullets(a.technicalDiscussion.map((t) => `**${t.topic}:** ${t.details}`)),
    "",
    "## Questions & Answers",
    "",
    qa,
    "",
    "## Decisions",
    "",
    bullets(a.decisions.map((d) => d.decision), "No decisions were recorded."),
    "",
    "## Action Items",
    "",
    actions,
    "",
    "## Open Questions",
    "",
    bullets(a.openQuestions, "None."),
    "",
    "## Next Steps",
    "",
    bullets(a.nextSteps),
    "",
  ].join("\n");
}

/** Parses an analysis-provided YYYY-MM-DD into a Date (UTC midnight), or null if it isn't one. */
export function parseIsoDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}
