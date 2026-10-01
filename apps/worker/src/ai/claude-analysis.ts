import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { meetingAnalysisContentSchema, NOT_SPECIFIED, type MeetingAnalysisContent } from "@meeting-assistant/shared";

export interface AnalysisInput {
  meeting: {
    title: string;
    dateText: string;
    meetingTypeLabel: string;
    platform: string;
    customerName: string | null;
    description: string | null;
    participants: { name: string | null; email: string; isExternal: boolean }[];
  };
  /** "[mm:ss] Speaker: text" lines, or null when no transcript exists. */
  transcriptText: string | null;
  notes: { category: string; text: string; at: string }[];
  previousMeetings: { title: string; date: string; summary: string; openQuestions: string[]; openActionItems: string[] }[];
}

export interface AIProvider {
  readonly name: string;
  isConfigured(): boolean;
  analyzeMeeting(input: AnalysisInput): Promise<MeetingAnalysisContent>;
}

export class AIRefusalError extends Error {}

const DEFAULT_MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `You are SE Copilot, an assistant for a B2B SaaS Solution Engineering team. You turn a customer meeting into structured meeting intelligence that a Solution Engineer will review before anything reaches the customer.

Accuracy rules — these override everything else:
- Use only what is in the transcript and the SE's notes. The calendar details and previous-meeting context are background for understanding; never present them as having been discussed in this meeting.
- Never invent requirements, product capabilities, answers, decisions, action items, owners, dates, commitments or technical limitations.
- A decision needs evidence that participants agreed to it. If something was only proposed or left ambiguous, it belongs in openQuestions or nextSteps, not decisions.
- An answer is only an answer if someone in the meeting gave it. Otherwise answer = null.
- Only set an action item's owner if the meeting names who will do it; only set dueDate when a calendar date was stated (or is unambiguous from the meeting date, e.g. "this Friday"); otherwise keep the spoken phrase in dueDateText or null.
- If the meeting objective was not stated or clearly implied, use exactly "${NOT_SPECIFIED}".
- Empty lists are correct when nothing applies. Do not pad.
- SE notes are authoritative where they conflict with an unclear transcript passage; notes tagged REQUIREMENT, DECISION, ACTION_ITEM, QUESTION or ANSWER map to those sections.
- Transcripts come from automatic captions and may mis-hear product names and numbers; prefer the SE notes' spelling, and do not "correct" numbers you cannot verify.

Writing style: concise, professional, customer-appropriate; no marketing language. risks and interestingTopics are internal-only: candid and specific. interestingTopics are reusable lessons for the wider organization, phrased without customer names.`;

function renderPrompt(input: AnalysisInput): string {
  const m = input.meeting;
  const participants = m.participants.map((p) => `- ${p.name ?? p.email} <${p.email}> (${p.isExternal ? "customer/external" : "internal"})`).join("\n");
  const notes =
    input.notes.length === 0
      ? "(none)"
      : input.notes.map((n) => `- [${n.at}] ${n.category}: ${n.text}`).join("\n");
  const previous =
    input.previousMeetings.length === 0
      ? "(no earlier meetings with this customer in SE Copilot)"
      : input.previousMeetings
          .map(
            (p) =>
              `### ${p.title} (${p.date})\n${p.summary}\nOpen questions then: ${p.openQuestions.join("; ") || "none"}\nOpen action items: ${p.openActionItems.join("; ") || "none"}`,
          )
          .join("\n\n");

  return [
    "<meeting_details>",
    `Title: ${m.title}`,
    `Date: ${m.dateText}`,
    `Type: ${m.meetingTypeLabel}`,
    `Platform: ${m.platform}`,
    `Customer: ${m.customerName ?? "unknown"}`,
    `Invite description:\n${(m.description ?? "").slice(0, 4000) || "(none)"}`,
    `Invited participants:\n${participants || "(none recorded)"}`,
    "</meeting_details>",
    "",
    "<previous_customer_context>",
    previous,
    "</previous_customer_context>",
    "",
    "<se_notes>",
    notes,
    "</se_notes>",
    "",
    "<transcript>",
    input.transcriptText ?? "(No transcript is available for this meeting. Work only from the SE notes.)",
    "</transcript>",
    "",
    "Produce the meeting analysis for this meeting.",
  ].join("\n");
}

export class ClaudeAnalysisProvider implements AIProvider {
  readonly name: string;
  private readonly model: string;

  constructor() {
    this.model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    this.name = `anthropic:${this.model}`;
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  async analyzeMeeting(input: AnalysisInput): Promise<MeetingAnalysisContent> {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      // Refusal fallback: if a safety classifier declines (e.g. a false
      // positive on security-heavy migration talk), the API re-runs the
      // request on an appropriate fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(meetingAnalysisContentSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderPrompt(input) }],
    });

    if (response.stop_reason === "refusal") {
      throw new AIRefusalError(`The model declined to analyze this meeting${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}.`);
    }
    if (response.stop_reason === "max_tokens") throw new Error("Analysis was cut off (max_tokens reached).");
    if (!response.parsed_output) throw new Error("Model response did not match the analysis schema.");
    // Re-validate: the parsed object must satisfy the shared contract exactly.
    return meetingAnalysisContentSchema.parse(response.parsed_output);
  }
}

let provider: AIProvider | null = null;
export function getAIProvider(): AIProvider {
  provider ??= new ClaudeAnalysisProvider();
  return provider;
}

/** Test seam only (never selected by configuration): swap in a deterministic provider. */
export function setAIProviderForTesting(p: AIProvider | null): void {
  provider = p;
}

export { renderPrompt as _renderAnalysisPromptForTests };
