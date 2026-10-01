import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { signUpSchema } from "@meeting-assistant/shared";
import { hashPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { onboardNewUser } from "@/lib/team-membership";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipLimit = await rateLimit(`signup:ip:${ip}`, 5, 60 * 60);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many sign-up attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Same generic response whether or not the account exists, to avoid
    // leaking which emails are registered.
    return NextResponse.json(
      { message: "If that email is available, an account has been created. Please sign in." },
      { status: 201 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name, passwordHash },
  });

  await onboardNewUser(user.id, user.email);
  await recordAuditEvent({ actorUserId: user.id, action: "auth.signup.created", ipAddress: ip });

  // TODO(email-verification): send a verification email via the notification
  // provider once that's wired up in Phase 5; VerificationToken table is
  // already in place for it.

  return NextResponse.json({ message: "Account created. Please sign in." }, { status: 201 });
}
