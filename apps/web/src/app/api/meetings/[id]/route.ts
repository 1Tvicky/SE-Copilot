import { NextResponse } from "next/server";
import { prisma, refreshBotEligibility, syncParticipantsAndCustomer } from "@meeting-assistant/db";
import { buildJobId, isTerminalStatus, QUEUE_NAMES, updateMeetingSchema } from "@meeting-assistant/shared";
import { findVisibleMeeting } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const meeting = await findVisibleMeeting(ctx, id, {
    customer: true,
    participants: true,
    botSessions: { orderBy: { createdAt: "desc" } },
    notes: { orderBy: { createdAt: "asc" } },
    analyses: { orderBy: { createdAt: "desc" }, take: 1 },
    mom: true,
    actionItems: { orderBy: { createdAt: "asc" } },
    events: { orderBy: { occurredAt: "asc" } },
  });
  if (!meeting) return jsonError(404, "Not found");
  const { passcodeEncrypted: _omit, ...safe } = meeting;
  return NextResponse.json(safe);
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  const parsed = updateMeetingSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const input = parsed.data;

  for (const userId of [input.assignedSeUserId, input.backupSeUserId].filter((v): v is string => typeof v === "string")) {
    const member = await prisma.user.findFirst({ where: { id: userId, teamId: meeting.teamId ?? undefined, deletedAt: null } });
    if (!member) return jsonError(400, "Assigned and backup SEs must be members of this meeting's team.");
  }

  await prisma.meetingSession.update({
    where: { id },
    data: {
      ...(input.meetingType ? { meetingType: input.meetingType, meetingTypeOverridden: true } : {}),
      ...(input.botOverride !== undefined ? { botOverride: input.botOverride } : {}),
      ...(input.captureMode ? { captureMode: input.captureMode } : {}),
      ...(input.assignedSeUserId ? { userId: input.assignedSeUserId } : {}),
      ...(input.backupSeUserId !== undefined ? { backupSeUserId: input.backupSeUserId } : {}),
    },
  });

  if (input.customerName && meeting.teamId) {
    const team = await prisma.team.findUniqueOrThrow({ where: { id: meeting.teamId } });
    const participants = await prisma.meetingParticipant.findMany({ where: { meetingSessionId: id } });
    await syncParticipantsAndCustomer(prisma, team, id, participants.map((p) => ({ email: p.email, name: p.name, role: p.role, responseStatus: p.responseStatus })), {
      customerNameOverride: input.customerName,
    });
  }

  const eligibility = await refreshBotEligibility(prisma, id);
  if (eligibility.changed || input.botOverride !== undefined) {
    await enqueue(QUEUE_NAMES.botSchedule, { meetingSessionId: id }, { singletonKey: buildJobId("bot", id) }).catch((err) =>
      console.error("Failed to enqueue bot reconcile", { id, err }),
    );
  }

  await recordAuditEvent({ actorUserId: ctx.user.id, action: "meeting.updated", targetType: "MeetingSession", targetId: id, metadata: input });
  return NextResponse.json({ ok: true, botEligible: eligibility.eligible });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;

  if (!isTerminalStatus(meeting.status)) return jsonError(409, "Cancel this meeting before deleting its data.");
  const sent = await prisma.emailMessage.count({ where: { meetingSessionId: id, status: "SENT" } });
  if (sent > 0 && ctx.user.role !== "ADMIN") {
    return jsonError(409, "This meeting has customer communication on record; only an admin can delete it.");
  }

  await prisma.meetingSession.delete({ where: { id } });
  await recordAuditEvent({ actorUserId: ctx.user.id, action: "meeting.deleted", targetType: "MeetingSession", targetId: id });
  return NextResponse.json({ message: "Deleted" });
}
