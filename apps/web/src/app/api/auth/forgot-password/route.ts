import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email() });

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const { email } = parsed.data;

  const limit = await rateLimit(`forgot-password:${email}`, 3, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const genericResponse = NextResponse.json({
    message: "If an account exists for that email, a reset link has been sent.",
  });

  const user = await prisma.user.findUnique({ where: { email } });
  // Always return the same generic response to avoid revealing whether the email is registered.
  if (!user || user.deletedAt) return genericResponse;

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your Meeting Assistant password",
    html: `<p>We received a request to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });

  return genericResponse;
}
