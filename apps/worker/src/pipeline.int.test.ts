import "./env.js";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentHash, ingestCalendarEvent, prisma } from "@meeting-assistant/db";
import { NOT_SPECIFIED, type CalendarEventRecord, type MeetingAnalysisContent } from "@meeting-assistant/shared";
import { setAIProviderForTesting, type AIProvider, type AnalysisInput } from "./ai/claude-analysis.js";
import { processMeetingAnalysis } from "./processors/meeting-analysis.js";
import { processEmailSend } from "./processors/email-send.js";
import { processBotEvent } from "./processors/bot-events.js";
import type { JobContext } from "./jobs.js";

/**
 * End-to-end pipeline tests against a real Postgres (the one in .env).
 * Opt-in: RUN_DB_TESTS=1 npm run test --workspace=apps/worker
 * Uses a deterministic AI stub — the only thing not exercised is the live
 * Claude call itself. Everything it creates is namespaced and cleaned up.
 */
const RUN = process.env.RUN_DB_TESTS === "1";
const suffix = `${Date.now()}`;
const domain = `int-${suffix}.test`;
const START = new Date(Date.now() + 2 * 3600_000);
const END = new Date(START.getTime() + 3600_000);

const fixture: MeetingAnalysisContent = {
  executiveSummary: "Contoso plans a Slack to Teams migration for about 2,000 users.",
  meetingObjective: "Scope the migration.",
  customerRequirements: [{ requirement: "Delta migration until cutover", kind: "technical" }],
  technicalDiscussion: [{ topic: "Permissions", details: "Channel-level permissions map; per-user posting needs a policy step." }],
  questions: [{ question: "Can posting permissions be preserved?", askedBy: "Jane", answer: "Channel-level yes." }],
  decisions: [{ decision: "Run a 50-user POC", context: null }],
  concerns: ["Cutover downtime"],
  risks: [{ risk: "Per-user permission gaps", impact: null }],
  actionItems: [
    { description: "Share workspace export stats", owner: "Raj", dueDate: "2026-10-09", dueDateText: "by Friday", priority: "high" },
    { description: "Share POC plan", owner: null, dueDate: null, dueDateText: null, priority: "medium" },
  ],
  openQuestions: [],
  nextSteps: ["POC kickoff"],
  interestingTopics: [{ topic: "Permission parity", whyInteresting: "Common migration misconception" }],
};

class StubAI implements AIProvider {
  readonly name = "stub:test";
  lastInput: AnalysisInput | null = null;
  isConfigured() {
    return true;
  }
  async analyzeMeeting(input: AnalysisInput) {
    this.lastInput = input;
    return fixture;
  }
}

const job = <T>(name: string, data: T): JobContext<T> => ({ id: crypto.randomUUID(), name: name as never, data, retryCount: 0, retryLimit: 0 });

describe.skipIf(!RUN)("SE Copilot pipeline (database)", () => {
  let teamId = "";
  let userId = "";
  let sourceId = "";
  const ai = new StubAI();

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "dev-outbox";
    setAIProviderForTesting(ai);
    const team = await prisma.team.create({
      data: {
        name: `Int team ${suffix}`,
        internalDomains: [domain],
        teamDlAddress: `se-team@${domain}`,
        senderMailbox: `copilot@${domain}`,
        timezone: "Asia/Kolkata",
      },
    });
    teamId = team.id;
    userId = (await prisma.user.create({ data: { name: "Int SE", email: `se@${domain}`, teamId } })).id;
    sourceId = (await prisma.teamMeetingSource.create({ data: { teamId, type: "SHARED_MAILBOX", displayName: "int", mailboxAddress: `meetings@${domain}` } })).id;
  });

  afterAll(async () => {
    setAIProviderForTesting(null);
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.$disconnect();
  });

  const event = (overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord => ({
    externalEventId: `evt-${suffix}`,
    iCalUId: `ical-${suffix}`,
    subject: "Contoso | Migration discovery",
    bodyText: "Join Zoom Meeting https://contoso.zoom.us/j/98765432101?pwd=abc",
    start: START,
    end: END,
    isCancelled: false,
    isPrivate: false,
    isAllDay: false,
    organizer: { email: `se@${domain}`, name: "Int SE" },
    attendees: [
      { email: "jane@contoso-int.example", name: "Jane", type: "required", responseStatus: "accepted" },
      { email: "room@" + domain, name: "Room", type: "resource", responseStatus: null },
    ],
    location: null,
    onlineMeetingJoinUrl: null,
    onlineMeetingProvider: null,
    lastModifiedAt: START,
    ...overrides,
  });

  it("ingests a calendar event: platform, customer, classification, assignment, eligibility", async () => {
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const result = await ingestCalendarEvent(prisma, team, sourceId, event());
    expect(result.created).toBe(true);
    const meeting = await prisma.meetingSession.findUniqueOrThrow({
      where: { id: result.meetingSessionId! },
      include: { participants: true, customer: true },
    });
    expect(meeting.platform).toBe("ZOOM");
    expect(meeting.meetingId).toBe("98765432101");
    expect(meeting.meetingType).toBe("MIGRATION_DISCUSSION");
    expect(meeting.userId).toBe(userId);
    expect(meeting.customer?.name).toBe("Contoso Int");
    expect(meeting.participants.map((p) => p.email).sort()).toEqual(["jane@contoso-int.example", `se@${domain}`]);
    // No RECALL_API_KEY in the test env: eligibility explains why instead of silently skipping.
    expect(meeting.botEligible).toBe(process.env.RECALL_API_KEY ? true : false);

    // Idempotent re-sync; then a reschedule is detected as a bot-relevant change.
    expect((await ingestCalendarEvent(prisma, team, sourceId, event())).botRelevantChange).toBe(false);
    const moved = await ingestCalendarEvent(prisma, team, sourceId, event({ start: new Date(Date.now() + 5 * 3600_000), end: new Date(Date.now() + 6 * 3600_000) }));
    expect(moved.botRelevantChange).toBe(true);

    // Cancellation in the calendar cancels the meeting.
    await ingestCalendarEvent(prisma, team, sourceId, event({ isCancelled: true }));
    expect((await prisma.meetingSession.findUniqueOrThrow({ where: { id: result.meetingSessionId! } })).status).toBe("CANCELLED");
  });

  async function makeMeeting(status: "SCHEDULED" | "FAILED" = "FAILED") {
    return prisma.meetingSession.create({
      data: {
        userId,
        teamId,
        name: "Contoso | POC planning",
        platform: "ZOOM",
        scheduledAt: new Date(Date.now() - 2 * 3600_000),
        endsAt: new Date(Date.now() - 3600_000),
        status,
        meetingType: "POC",
        participants: {
          create: [
            { email: "jane@contoso-int.example", name: "Jane", isExternal: true },
            { email: `se@${domain}`, name: "Int SE", isExternal: false, role: "ORGANIZER" },
          ],
        },
        notes: { create: [{ category: "DECISION", text: "Run a 50-user POC", authorUserId: userId }] },
        transcripts: {
          create: {
            source: "PASTED_TEXT",
            status: "READY",
            segments: { create: [{ speakerLabel: "Jane", startMs: 0, endMs: 1000, text: "We need delta migration." }] },
          },
        },
      },
    });
  }

  it("analysis recovers a FAILED-capture meeting into analysis, action items and a MOM awaiting approval", async () => {
    const meeting = await makeMeeting("FAILED");
    await processMeetingAnalysis(job("meeting-analysis", { meetingSessionId: meeting.id, reason: "manual" as const, requestedById: userId }));

    expect(ai.lastInput?.transcriptText).toContain("Jane: We need delta migration.");
    expect(ai.lastInput?.notes[0]).toMatchObject({ category: "DECISION", text: "Run a 50-user POC" });

    const after = await prisma.meetingSession.findUniqueOrThrow({ where: { id: meeting.id }, include: { mom: true, actionItems: true, analyses: true } });
    expect(after.status).toBe("COMPLETED");
    expect(after.analyses[0]?.status).toBe("READY");
    expect(after.actionItems).toHaveLength(2);
    expect(after.actionItems.find((a) => a.owner === "Raj")?.dueDate?.toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(after.mom?.status).toBe("AWAITING_APPROVAL");
    expect(after.mom?.markdown).toContain("## Action Items");
    expect(after.mom?.markdown).not.toContain("Per-user permission gaps"); // internal risk stays internal
    expect(after.mom?.markdown).toContain("Share POC plan — **Owner:** TBD");
    expect(after.mom?.markdown).toContain(`- None.`); // empty open questions, not invented ones
    void NOT_SPECIFIED;

    const events = await prisma.approvalEvent.findMany({ where: { meetingSessionId: meeting.id } });
    expect(events.map((e) => e.action)).toEqual(["AI_GENERATED"]);
  });

  async function approvedMeetingWithQueuedEmail() {
    const meeting = await makeMeeting("FAILED");
    await processMeetingAnalysis(job("meeting-analysis", { meetingSessionId: meeting.id, reason: "manual" as const }));
    const mom = await prisma.mom.findUniqueOrThrow({ where: { meetingSessionId: meeting.id } });
    const hash = contentHash(mom.markdown);
    await prisma.mom.update({ where: { id: mom.id }, data: { status: "APPROVED", approvedHash: hash, approvedAt: new Date(), approvedById: userId } });
    const email = await prisma.emailMessage.create({
      data: {
        teamId,
        meetingSessionId: meeting.id,
        momId: mom.id,
        kind: "CUSTOMER_MOM",
        status: "QUEUED",
        fromAddress: `se-team@${domain}`,
        senderMailbox: `copilot@${domain}`,
        toJson: [{ address: "jane@contoso-int.example" }],
        subject: "Re: Contoso | POC planning",
        bodyHtml: "<p>MOM</p>",
        bodyText: "MOM",
        momHash: hash,
        confirmedById: userId,
        confirmedAt: new Date(),
      },
    });
    return { meeting, mom, email };
  }

  it("sends an approved, confirmed email exactly once and records it", async () => {
    const { mom, email } = await approvedMeetingWithQueuedEmail();
    await processEmailSend(job("email-send", { emailMessageId: email.id }));
    await processEmailSend(job("email-send", { emailMessageId: email.id })); // duplicate delivery is a no-op

    const sent = await prisma.emailMessage.findUniqueOrThrow({ where: { id: email.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.providerMessageId).toMatch(/^dev-outbox:/);
    expect((await prisma.mom.findUniqueOrThrow({ where: { id: mom.id } })).status).toBe("SENT");
    const sentEvents = await prisma.approvalEvent.findMany({ where: { contentId: email.id, action: "SENT" } });
    expect(sentEvents).toHaveLength(1);
  });

  it("refuses to send when the MOM was changed after approval", async () => {
    const { mom, email } = await approvedMeetingWithQueuedEmail();
    await prisma.mom.update({ where: { id: mom.id }, data: { markdown: `${mom.markdown}\n\nSneaky edit` } });
    await processEmailSend(job("email-send", { emailMessageId: email.id }));
    const failed = await prisma.emailMessage.findUniqueOrThrow({ where: { id: email.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toMatch(/changed after it was approved/);
  });

  it("maps notetaker webhooks onto the meeting, and a lobby timeout to 'capture unavailable'", async () => {
    const meeting = await makeMeeting("SCHEDULED");
    const bot = await prisma.meetingBotSession.create({
      data: { meetingSessionId: meeting.id, provider: "recall", externalBotId: `bot-${suffix}`, botName: "SE Copilot Notetaker" },
    });
    const ev = (code: string, subCode: string | null = null) =>
      job("bot-events", { provider: "recall" as const, event: `bot.${code}`, externalBotId: bot.externalBotId!, code, subCode, occurredAt: new Date().toISOString(), deliveryId: crypto.randomUUID() });

    await processBotEvent(ev("joining_call"));
    await processBotEvent(ev("in_waiting_room"));
    expect((await prisma.meetingSession.findUniqueOrThrow({ where: { id: meeting.id } })).status).toBe("WAITING_FOR_ADMISSION");

    await processBotEvent(ev("call_ended", "timeout_exceeded_waiting_room"));
    const failed = await prisma.meetingSession.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toMatch(/never admitted/);
    expect((await prisma.meetingBotSession.findUniqueOrThrow({ where: { id: bot.id } })).status).toBe("FAILED");

    // A late, out-of-order event can't resurrect it.
    await processBotEvent(ev("joining_call"));
    expect((await prisma.meetingBotSession.findUniqueOrThrow({ where: { id: bot.id } })).status).toBe("FAILED");
  });
});
