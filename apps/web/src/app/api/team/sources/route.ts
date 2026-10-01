import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { meetingSourceSchema, QUEUE_NAMES } from "@meeting-assistant/shared";
import { canManageTeam } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

export async function GET() {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.teamId) return NextResponse.json({ items: [] });
  const items = await prisma.teamMeetingSource.findMany({ where: { teamId: ctx.teamId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.teamId || !canManageTeam(ctx, ctx.teamId)) return jsonError(403, "Only team managers and admins can add meeting sources.");

  const parsed = meetingSourceSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const source = await prisma.teamMeetingSource.create({
    data: {
      teamId: ctx.teamId,
      type: parsed.data.type,
      displayName: parsed.data.displayName,
      mailboxAddress: parsed.data.type === "GROUP_CALENDAR" ? null : parsed.data.mailboxAddress ?? null,
      groupId: parsed.data.type === "GROUP_CALENDAR" ? parsed.data.groupId ?? null : null,
      isEnabled: parsed.data.isEnabled,
      syncDaysAhead: parsed.data.syncDaysAhead,
    },
  });
  await recordAuditEvent({ actorUserId: ctx.user.id, action: "team.source_added", targetType: "TeamMeetingSource", targetId: source.id });
  await enqueue(QUEUE_NAMES.calendarSync, { sourceId: source.id }).catch(() => undefined);
  return NextResponse.json(source, { status: 201 });
}
