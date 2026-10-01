import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { buildJobId, parseTranscriptText, QUEUE_NAMES, transcriptInputSchema } from "@meeting-assistant/shared";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

/**
 * Upload or paste a transcript: the fallback when automated capture was
 * unavailable (bot not admitted, captions disabled, unsupported platform).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;
  if (meeting.status === "CANCELLED") return jsonError(409, "This meeting was cancelled.");

  const parsed = transcriptInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const segments = parseTranscriptText(parsed.data.text);
  if (segments.length === 0) return jsonError(400, "No transcript text could be read from that input.");

  const transcript = await prisma.$transaction(async (tx) => {
    const t = await tx.transcript.create({
      data: {
        meetingSessionId: id,
        source: parsed.data.source === "upload" ? "UPLOADED_FILE" : "PASTED_TEXT",
        status: "READY",
        provider: parsed.data.fileName ? `upload:${parsed.data.fileName}` : parsed.data.source,
        generatedAt: new Date(),
      },
    });
    await tx.transcriptSegment.createMany({ data: segments.map((s) => ({ ...s, transcriptId: t.id })) });
    return t;
  });

  await recordAuditEvent({
    actorUserId: ctx.user.id,
    action: "meeting.transcript_added",
    targetType: "MeetingSession",
    targetId: id,
    metadata: { source: parsed.data.source, segments: segments.length },
  });
  if (parsed.data.analyze) {
    await enqueue(
      QUEUE_NAMES.meetingAnalysis,
      { meetingSessionId: id, reason: "manual", requestedById: ctx.user.id },
      { singletonKey: buildJobId("analysis", id) },
    );
  }
  return NextResponse.json({ id: transcript.id, segments: segments.length, analysisQueued: parsed.data.analyze }, { status: 201 });
}
