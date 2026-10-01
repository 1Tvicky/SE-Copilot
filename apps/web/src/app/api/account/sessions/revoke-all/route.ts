import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { getApiUser } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

export async function POST() {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } }),
    prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAuditEvent({ actorUserId: user.id, action: "auth.signout_all_sessions" });

  return NextResponse.json({ message: "Signed out of all sessions" });
}
