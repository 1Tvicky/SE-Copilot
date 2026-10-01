import { NextResponse } from "next/server";
import { prisma, refreshBotEligibility, syncParticipantsAndCustomer } from "@meeting-assistant/db";
import {
  buildJobId,
  classifyMeeting,
  createMeetingSessionSchema,
  detectMeetingPlatform,
  isInternalEmail,
  listMeetingSessionsQuerySchema,
  QUEUE_NAMES,
} from "@meeting-assistant/shared";
import { meetingVisibilityWhere } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

export async function GET(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const parsed = listMeetingSessionsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return invalidInput(parsed.error);
  const { q, status, from, to, sortBy, sortDir, page, pageSize } = parsed.data;

  const where = {
    AND: [
      meetingVisibilityWhere(ctx),
      status ? { status } : {},
      q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { customer: { name: { contains: q, mode: "insensitive" as const } } }] } : {},
      from || to ? { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
    ],
  };

  const [total, items] = await Promise.all([
    prisma.meetingSession.count({ where }),
    prisma.meetingSession.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        meetingType: true,
        scheduledAt: true,
        endsAt: true,
        botEligible: true,
        customer: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
        mom: { select: { status: true } },
        botSessions: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  return NextResponse.json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

/** Manually add a meeting (calendar not connected, or the invite never reached the team mailbox). */
export async function POST(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.teamId) return jsonError(409, "You are not a member of a Solution Engineering team yet. Ask an admin to add you.");

  const parsed = createMeetingSessionSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const input = parsed.data;

  const team = await prisma.team.findUniqueOrThrow({ where: { id: ctx.teamId } });
  const detection = input.meetingUrl ? detectMeetingPlatform({ onlineMeetingJoinUrl: input.meetingUrl }) : null;
  const hasExternal = input.participants.some((p) => !isInternalEmail(p.email, team.internalDomains));
  const meetingType =
    input.meetingType ?? classifyMeeting({ subject: input.name, body: input.description, hasExternalParticipants: hasExternal || Boolean(input.customerName) });

  const meeting = await prisma.meetingSession.create({
    data: {
      userId: ctx.user.id,
      teamId: team.id,
      origin: "MANUAL",
      name: input.name,
      description: input.description,
      platform: detection?.platform ?? "UNKNOWN",
      meetingUrl: detection?.meetingUrl ?? null,
      meetingId: detection?.zoomMeetingId ?? null,
      scheduledAt: input.scheduledAt,
      endsAt: new Date(input.scheduledAt.getTime() + input.durationMinutes * 60_000),
      maxDurationMinutes: input.durationMinutes,
      timezone: input.timezone,
      meetingType,
      meetingTypeOverridden: Boolean(input.meetingType),
      captureMode: input.captureMode,
      participantDisplayName: team.botDisplayName,
      organizerEmail: ctx.user.email,
      organizerName: ctx.user.name,
      status: "SCHEDULED",
      events: { create: { fromStatus: "DRAFT", toStatus: "SCHEDULED", source: "USER", message: "Meeting added manually" } },
    },
    select: { id: true },
  });

  await syncParticipantsAndCustomer(
    prisma,
    team,
    meeting.id,
    [
      { email: ctx.user.email, name: ctx.user.name, role: "ORGANIZER" },
      ...input.participants.map((p) => ({ email: p.email, name: p.name ?? null, role: "REQUIRED" as const })),
    ],
    { customerNameOverride: input.customerName },
  );
  await refreshBotEligibility(prisma, meeting.id);

  await recordAuditEvent({ actorUserId: ctx.user.id, action: "meeting.created", targetType: "MeetingSession", targetId: meeting.id });
  try {
    await enqueue(QUEUE_NAMES.botSchedule, { meetingSessionId: meeting.id }, { singletonKey: buildJobId("bot", meeting.id) });
  } catch (err) {
    // The meeting is saved; the next calendar/bot reconcile or a manual toggle will retry scheduling.
    console.error("Failed to enqueue bot scheduling", { meetingId: meeting.id, err });
  }

  return NextResponse.json({ id: meeting.id }, { status: 201 });
}
