import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { getApiSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { hashSessionId } from "@/lib/session-hash";
import { recordAuditEvent } from "@/lib/audit";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(10)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
});

export async function POST(request: Request) {
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user, sessionId } = session;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record?.passwordHash) {
    return NextResponse.json(
      { error: "This account signs in with Google and has no password to change." },
      { status: 400 },
    );
  }

  const valid = await verifyPassword(record.passwordHash, parsed.data.currentPassword);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  const currentSessionHash = sessionId ? hashSessionId(sessionId) : null;

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
    prisma.userSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(currentSessionHash ? { sessionIdHash: { not: currentSessionHash } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAuditEvent({ actorUserId: user.id, action: "account.password_changed" });

  return NextResponse.json({ message: "Password updated. Other devices have been signed out." });
}
