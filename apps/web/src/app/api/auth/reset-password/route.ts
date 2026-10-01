import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { hashPassword } from "@/lib/password";
import { recordAuditEvent } from "@/lib/audit";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { token, password } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 }, // invalidate every existing session
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.userSession.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAuditEvent({ actorUserId: resetToken.userId, action: "auth.password_reset" });

  return NextResponse.json({ message: "Password updated. Please sign in." });
}
