import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { notificationPreferencesSchema } from "@meeting-assistant/shared";
import { getApiUser } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { recordAuditEvent } from "@/lib/audit";

export async function GET() {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, email: true, image: true, notificationPrefs: true, passwordHash: true, createdAt: true },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: record.id,
    name: record.name,
    email: record.email,
    image: record.image,
    notificationPrefs: record.notificationPrefs,
    hasPassword: record.passwordHash !== null,
    createdAt: record.createdAt,
  });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  notificationPrefs: notificationPreferencesSchema.partial().optional(),
});

export async function PATCH(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { notificationPrefs: true } });
  const mergedPrefs = parsed.data.notificationPrefs
    ? { ...(current?.notificationPrefs as object), ...parsed.data.notificationPrefs }
    : undefined;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(mergedPrefs ? { notificationPrefs: mergedPrefs } : {}),
    },
  });

  return NextResponse.json({ message: "Updated" });
}

const deleteSchema = z.object({ password: z.string().optional() });

export async function DELETE(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (record.passwordHash) {
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    const valid = parsed.success && parsed.data.password && (await verifyPassword(record.passwordHash, parsed.data.password));
    if (!valid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
    }
  }

  await recordAuditEvent({ actorUserId: user.id, action: "account.deleted", targetType: "User", targetId: user.id });
  await prisma.user.delete({ where: { id: user.id } });

  return NextResponse.json({ message: "Account deleted" });
}
