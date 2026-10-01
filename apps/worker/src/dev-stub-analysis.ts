import "./env.js";

/**
 * DEV ONLY — local verification helper, never imported by the app.
 * Runs the real meeting-analysis processor for one meeting with a
 * deterministic stub instead of Claude, so the MOM → approval → email flow
 * can be exercised without an ANTHROPIC_API_KEY.
 *   npx tsx src/dev-stub-analysis.ts <meetingSessionId>
 */
import { prisma } from "@meeting-assistant/db";
import { setAIProviderForTesting, type AIProvider, type AnalysisInput } from "./ai/claude-analysis.js";
import { processMeetingAnalysis } from "./processors/meeting-analysis.js";

if (process.env.NODE_ENV === "production") throw new Error("dev-stub-analysis must not run in production");

const stub: AIProvider = {
  name: "dev-stub",
  isConfigured: () => true,
  async analyzeMeeting(input: AnalysisInput) {
    // Built only from what the input actually contains: notes become the matching sections.
    const notes = (c: string) => input.notes.filter((n) => n.category === c).map((n) => n.text);
    return {
      executiveSummary: `[DEV STUB — not AI output] ${input.meeting.title}: ${input.notes.length} SE notes, ${input.transcriptText ? "transcript available" : "no transcript"}.`,
      meetingObjective: input.meeting.description || "Not specified in the meeting.",
      customerRequirements: notes("REQUIREMENT").map((requirement) => ({ requirement, kind: "technical" as const })),
      technicalDiscussion: [],
      questions: notes("QUESTION").map((question, i) => ({ question, askedBy: null, answer: notes("ANSWER")[i] ?? null })),
      decisions: notes("DECISION").map((decision) => ({ decision, context: null })),
      concerns: [],
      risks: [],
      actionItems: notes("ACTION_ITEM").map((description) => ({ description, owner: null, dueDate: null, dueDateText: null, priority: "medium" as const })),
      openQuestions: [],
      nextSteps: [],
      interestingTopics: [],
    };
  },
};

const id = process.argv[2];
if (!id) throw new Error("Usage: npx tsx src/dev-stub-analysis.ts <meetingSessionId>");
setAIProviderForTesting(stub);
await processMeetingAnalysis({ id: crypto.randomUUID(), name: "meeting-analysis", data: { meetingSessionId: id, reason: "manual" }, retryCount: 0, retryLimit: 0 });
const mom = await prisma.mom.findUnique({ where: { meetingSessionId: id } });
console.log("MOM status:", mom?.status ?? "none");
await prisma.$disconnect();
process.exit(0);
