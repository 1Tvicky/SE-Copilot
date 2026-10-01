import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { prisma } from "@meeting-assistant/db";
import { getApiUser } from "@/lib/session";
import { canManageMeeting, getUserContext, meetingVisibilityWhere, type UserContext } from "@/lib/access";

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

export function invalidInput(err: ZodError) {
  const flat = err.flatten();
  const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? "Invalid input";
  return jsonError(400, String(first), flat);
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

/** Authenticated user + team context, or a 401 response. */
export async function requireApiContext(): Promise<UserContext | NextResponse> {
  const user = await getApiUser();
  if (!user) return jsonError(401, "Unauthorized");
  return getUserContext(user);
}

/**
 * Loads a meeting the caller may change. 404 if they can't see it at all
 * (don't leak existence), 403 if they can see but not manage it.
 */
export async function requireManageableMeeting(ctx: UserContext, id: string) {
  const meeting = await prisma.meetingSession.findFirst({ where: { AND: [{ id }, meetingVisibilityWhere(ctx)] } });
  if (!meeting) return jsonError(404, "Not found");
  if (!canManageMeeting(ctx, meeting)) {
    return jsonError(403, "Only the assigned SE, the backup SE, or a team manager can change this meeting.");
  }
  return meeting;
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
