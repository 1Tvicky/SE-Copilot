import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { QUEUE_NAMES } from "@meeting-assistant/shared";
import { canManageTeam } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

type RouteParams = { params: Promise<{ sourceId: string }> };

const patchSchema = z.object({
  isEnabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  syncDaysAhead: z.number().int().min(1).max(60).optional(),
});

async function load(params: RouteParams["params"]) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { sourceId } = await params;
  const source = await prisma.teamMeetingSource.findUnique({ where: { id: sourceId } });
  if (!source || !canManageTeam(ctx, source.teamId)) return jsonError(404, "Not found");
  return { ctx, source };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const loaded = await load(params);
  if (loaded instanceof NextResponse) return loaded;
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const source = await prisma.teamMeetingSource.update({ where: { id: loaded.source.id }, data: parsed.data });
  await recordAuditEvent({ actorUserId: loaded.ctx.user.id, action: "team.source_updated", targetType: "TeamMeetingSource", targetId: source.id, metadata: parsed.data });
  return NextResponse.json(source);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const loaded = await load(params);
  if (loaded instanceof NextResponse) return loaded;
  // Meetings already detected keep their history; they just lose the link to the source.
  await prisma.teamMeetingSource.delete({ where: { id: loaded.source.id } });
  await recordAuditEvent({ actorUserId: loaded.ctx.user.id, action: "team.source_deleted", targetType: "TeamMeetingSource", targetId: loaded.source.id });
  return NextResponse.json({ ok: true });
}

/** "Sync now" — queues an immediate calendar sync for this source. */
export async function POST(_request: Request, { params }: RouteParams) {
  const loaded = await load(params);
  if (loaded instanceof NextResponse) return loaded;
  await enqueue(QUEUE_NAMES.calendarSync, { sourceId: loaded.source.id });
  return NextResponse.json({ queued: true }, { status: 202 });
}
