import { prisma, applyMeetingTransition, recordApprovalEvent, type Prisma } from "@meeting-assistant/db";
import {
  isFinalJobAttempt,
  MEETING_TYPE_LABELS,
  meetingAnalysisContentSchema,
  parseIsoDateOnly,
  renderMomMarkdown,
  type MeetingAnalysisContent,
  type MeetingAnalysisJobData,
  type MeetingTypeValue,
} from "@meeting-assistant/shared";
import { getAIProvider, type AnalysisInput } from "../ai/claude-analysis.js";
import type { JobContext } from "../jobs.js";
import { logger } from "../logger.js";
import { notify } from "../notify.js";

export function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "October 1, 2026, 3:48 PM GMT+5:30". (Intl rejects dateStyle combined with timeZoneName, so spell the parts out.) */
export function formatMeetingDate(date: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(date);
  }
}

const PRIORITY = { low: "LOW", medium: "MEDIUM", high: "HIGH" } as const;

export async function processMeetingAnalysis(job: JobContext<MeetingAnalysisJobData>): Promise<void> {
  const { meetingSessionId } = job.data;
  const log = logger.child({ meetingSessionId, reason: job.data.reason });
  const ai = getAIProvider();

  const meeting = await prisma.meetingSession.findUnique({
    where: { id: meetingSessionId },
    include: {
      team: true,
      customer: true,
      participants: { orderBy: { role: "asc" } },
      notes: { orderBy: { createdAt: "asc" } },
      transcripts: { where: { status: "READY" }, orderBy: { createdAt: "desc" }, take: 1, include: { segments: { orderBy: { startMs: "asc" } } } },
      mom: true,
    },
  });
  if (!meeting || meeting.status === "CANCELLED") return;

  const transcript = meeting.transcripts[0];
  const transcriptText = transcript?.segments.length
    ? transcript.segments.map((s) => `[${formatOffset(s.startMs)}] ${s.speakerLabel ?? "Unknown speaker"}: ${s.text}`).join("\n")
    : null;
  if (!transcriptText && meeting.notes.length === 0) {
    // Nothing to work from: refusing is the only non-fabricating option.
    await prisma.meetingAnalysis.create({
      data: { meetingSessionId, status: "FAILED", failureReason: "No transcript or SE notes are available to analyze." },
    });
    return;
  }

  // Move into PROCESSING (valid from pre-capture states and from FAILED: the
  // "capture unavailable, SE supplied a transcript/notes" recovery path).
  if (meeting.status !== "PROCESSING" && meeting.status !== "COMPLETED") {
    await applyMeetingTransition(prisma, {
      meetingSessionId,
      toStatus: "PROCESSING",
      source: "WORKER",
      message: transcriptText ? "Analyzing transcript and notes" : "Analyzing SE notes (no transcript)",
      idempotencyKey: `analysis-start:${job.id}`,
    });
  }

  if (!ai.isConfigured()) {
    // Configuration problem, not a transient failure: don't burn retries.
    const reason = "AI provider is not configured (set ANTHROPIC_API_KEY on the worker)";
    await prisma.meetingAnalysis.create({ data: { meetingSessionId, status: "FAILED", model: ai.name, failureReason: reason } });
    await applyMeetingTransition(prisma, {
      meetingSessionId,
      toStatus: "FAILED",
      source: "WORKER",
      message: `Analysis failed: ${reason}`,
      idempotencyKey: `analysis-unconfigured:${job.id}`,
      extraData: { failureReason: `Analysis failed: ${reason}` },
    });
    log.error(reason);
    return;
  }

  const analysis = await prisma.meetingAnalysis.create({
    data: {
      meetingSessionId,
      status: "PROCESSING",
      model: ai.name,
      inputsJson: { transcriptSegments: transcript?.segments.length ?? 0, notes: meeting.notes.length, reason: job.data.reason },
    },
  });

  try {
    const timeZone = meeting.team?.timezone ?? meeting.timezone;

    const previous = meeting.customerId
      ? await prisma.meetingAnalysis.findMany({
          where: { status: "READY", meetingSession: { customerId: meeting.customerId, id: { not: meeting.id } } },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { meetingSession: { select: { name: true, scheduledAt: true, actionItems: { where: { status: { not: "COMPLETED" } } } } } },
        })
      : [];

    const input: AnalysisInput = {
      meeting: {
        title: meeting.name,
        dateText: formatMeetingDate(meeting.scheduledAt, timeZone),
        meetingTypeLabel: MEETING_TYPE_LABELS[meeting.meetingType as MeetingTypeValue],
        platform: meeting.platform,
        customerName: meeting.customer?.name ?? null,
        description: meeting.description,
        participants: meeting.participants.map((p) => ({ name: p.name, email: p.email, isExternal: p.isExternal })),
      },
      transcriptText,
      notes: meeting.notes.map((n) => ({ category: n.category, text: n.text, at: formatMeetingDate(n.createdAt, timeZone) })),
      previousMeetings: previous.map((p) => {
        const c = meetingAnalysisContentSchema.safeParse(p.contentJson);
        return {
          title: p.meetingSession.name,
          date: formatMeetingDate(p.meetingSession.scheduledAt, timeZone),
          summary: c.success ? c.data.executiveSummary : "",
          openQuestions: c.success ? c.data.openQuestions : [],
          openActionItems: p.meetingSession.actionItems.map((a) => a.description),
        };
      }),
    };

    const content: MeetingAnalysisContent = await ai.analyzeMeeting(input);
    const momMarkdown = renderMomMarkdown(
      {
        title: meeting.name,
        customerName: meeting.customer?.name ?? null,
        dateText: formatMeetingDate(meeting.scheduledAt, timeZone),
        participants: meeting.participants.map((p) => ({ name: p.name, email: p.email })),
        meetingTypeLabel: MEETING_TYPE_LABELS[meeting.meetingType as MeetingTypeValue],
      },
      content,
    );

    await prisma.$transaction(async (tx) => {
      await tx.meetingAnalysis.update({
        where: { id: analysis.id },
        data: { status: "READY", contentJson: content as unknown as Prisma.InputJsonValue, generatedAt: new Date() },
      });

      // AI action items are regenerated with the analysis; manually added ones are kept.
      await tx.actionItem.deleteMany({ where: { meetingSessionId, origin: "ai", status: "OPEN" } });
      if (content.actionItems.length) {
        await tx.actionItem.createMany({
          data: content.actionItems.map((a) => ({
            meetingSessionId,
            customerId: meeting.customerId,
            description: a.description,
            owner: a.owner,
            dueDate: parseIsoDateOnly(a.dueDate),
            dueDateText: a.dueDateText ?? a.dueDate,
            priority: PRIORITY[a.priority],
            origin: "ai",
          })),
        });
      }

      // A MOM that already went to the customer is a record; never overwrite it.
      if (meeting.mom?.status === "SENT") return;

      const mom = meeting.mom
        ? await tx.mom.update({
            where: { id: meeting.mom.id },
            data: {
              analysisId: analysis.id,
              aiMarkdown: momMarkdown,
              markdown: momMarkdown,
              status: "AWAITING_APPROVAL",
              version: { increment: 1 },
              generatedAt: new Date(),
              approvedHash: null,
              approvedAt: null,
              approvedById: null,
              rejectedAt: null,
              rejectedById: null,
              rejectionReason: null,
              editedAt: null,
              editedById: null,
            },
          })
        : await tx.mom.create({
            data: { meetingSessionId, analysisId: analysis.id, aiMarkdown: momMarkdown, markdown: momMarkdown, status: "AWAITING_APPROVAL" },
          });

      // Any unsent email drafts were built from the previous version.
      await tx.emailMessage.updateMany({ where: { momId: mom.id, status: "DRAFT" }, data: { status: "CANCELLED" } });

      await recordApprovalEvent(tx, {
        contentType: "MOM",
        contentId: mom.id,
        meetingSessionId,
        action: meeting.mom ? "REGENERATED" : "AI_GENERATED",
        actorUserId: job.data.requestedById ?? null,
        snapshot: momMarkdown,
        metadata: { model: ai.name, version: mom.version, analysisId: analysis.id },
      });
    });

    await applyMeetingTransition(prisma, {
      meetingSessionId,
      toStatus: "COMPLETED",
      source: "WORKER",
      message: "Analysis and MOM draft ready for SE review",
      idempotencyKey: `analysis-done:${analysis.id}`,
    });
    log.info({ actionItems: content.actionItems.length }, "Meeting analysis ready");
    if (meeting.mom?.status !== "SENT") {
      void notify(meetingSessionId, "MOM_READY", "Your meeting summary, MOM, action items and follow-up email are prepared. The customer MOM is awaiting your approval.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown analysis error";
    await prisma.meetingAnalysis.update({ where: { id: analysis.id }, data: { status: "FAILED", failureReason: message.slice(0, 2000) } });
    if (isFinalJobAttempt(job.retryCount, job.retryLimit)) {
      await applyMeetingTransition(prisma, {
        meetingSessionId,
        toStatus: "FAILED",
        source: "WORKER",
        message: `Analysis failed: ${message}`,
        idempotencyKey: `analysis-failed:${job.id}`,
        extraData: { failureReason: `Analysis failed: ${message}` },
      });
      void notify(meetingSessionId, "MEETING_FAILED", `Meeting analysis failed: ${message}. You can retry from the meeting page.`);
    }
    throw err;
  }
}
