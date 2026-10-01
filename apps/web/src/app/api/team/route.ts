import { NextResponse } from "next/server";
import { prisma, refreshBotEligibility } from "@meeting-assistant/db";
import { buildJobId, QUEUE_NAMES, teamSettingsSchema } from "@meeting-assistant/shared";
import { canManageTeam } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext } from "@/lib/api";
import { recordAuditEvent } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";

export async function GET() {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.teamId) return jsonError(404, "You are not a member of a team.");
  const team = await prisma.team.findUniqueOrThrow({ where: { id: ctx.teamId } });
  return NextResponse.json(team);
}

/** Team settings (DL, sender, notetaker rules). Managers/admins only. */
export async function PATCH(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.teamId || !canManageTeam(ctx, ctx.teamId)) return jsonError(403, "Only team managers and admins can change team settings.");

  const parsed = teamSettingsSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);

  const team = await prisma.team.update({ where: { id: ctx.teamId }, data: parsed.data });
  await recordAuditEvent({ actorUserId: ctx.user.id, action: "team.settings_updated", targetType: "Team", targetId: team.id, metadata: parsed.data });

  // Rules changed: re-evaluate every upcoming meeting and reconcile its notetaker.
  const upcoming = await prisma.meetingSession.findMany({
    where: { teamId: team.id, status: { in: ["SCHEDULED", "PREPARING"] }, scheduledAt: { gte: new Date(Date.now() - 3600_000) } },
    select: { id: true },
  });
  for (const m of upcoming) {
    const { changed } = await refreshBotEligibility(prisma, m.id);
    if (changed) await enqueue(QUEUE_NAMES.botSchedule, { meetingSessionId: m.id }, { singletonKey: buildJobId("bot", m.id) }).catch(() => undefined);
  }
  return NextResponse.json(team);
}
