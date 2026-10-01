import type { Session } from "next-auth";
import { prisma, type Prisma } from "@meeting-assistant/db";

export type SessionUser = Session["user"];

export interface UserContext {
  user: SessionUser;
  teamId: string | null;
}

/** Loads the user's team membership (not in the JWT, so team moves apply immediately). */
export async function getUserContext(user: SessionUser): Promise<UserContext> {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { teamId: true } });
  return { user, teamId: row?.teamId ?? null };
}

/**
 * Which meetings a user may SEE. Team rotation means any SE may need to
 * cover any team meeting, so team members can view all of their team's
 * meetings; users outside the team only see meetings assigned to them.
 * Admins see everything.
 */
export function meetingVisibilityWhere(ctx: UserContext): Prisma.MeetingSessionWhereInput {
  if (ctx.user.role === "ADMIN") return {};
  const own: Prisma.MeetingSessionWhereInput[] = [{ userId: ctx.user.id }, { backupSeUserId: ctx.user.id }];
  return ctx.teamId ? { OR: [...own, { teamId: ctx.teamId }] } : { OR: own };
}

/**
 * Who may CHANGE a meeting or approve/send its customer communication: the
 * assigned SE, the backup SE, and the team's managers/admins.
 */
export function canManageMeeting(
  ctx: UserContext,
  meeting: { userId: string; backupSeUserId: string | null; teamId: string | null },
): boolean {
  if (ctx.user.role === "ADMIN") return true;
  if (meeting.userId === ctx.user.id || meeting.backupSeUserId === ctx.user.id) return true;
  return ctx.user.role === "MANAGER" && Boolean(meeting.teamId) && meeting.teamId === ctx.teamId;
}

export function canManageTeam(ctx: UserContext, teamId: string): boolean {
  return ctx.user.role === "ADMIN" || (ctx.user.role === "MANAGER" && ctx.teamId === teamId);
}

/** Loads a meeting the user can see, or null (callers return 404 so existence isn't leaked). */
export async function findVisibleMeeting<T extends Prisma.MeetingSessionInclude>(ctx: UserContext, id: string, include?: T) {
  return prisma.meetingSession.findFirst({
    where: { AND: [{ id }, meetingVisibilityWhere(ctx)] },
    include,
  }) as Promise<Prisma.MeetingSessionGetPayload<{ include: T }> | null>;
}
