import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { getApiAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

const patchSchema = z
  .object({ role: z.enum(["USER", "MANAGER", "ADMIN"]).optional(), teamId: z.string().uuid().nullable().optional() })
  .refine((v) => v.role !== undefined || v.teamId !== undefined, "Nothing to update");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getApiAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (id === admin.id && parsed.data.role !== undefined) {
    return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  }
  if (parsed.data.teamId && !(await prisma.team.findUnique({ where: { id: parsed.data.teamId } }))) {
    return NextResponse.json({ error: "Unknown team" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.user.update({ where: { id }, data: parsed.data });
  await recordAuditEvent({
    actorUserId: admin.id,
    action: parsed.data.role !== undefined ? "admin.user_role_changed" : "admin.user_team_changed",
    targetType: "User",
    targetId: id,
    metadata: { from: { role: target.role, teamId: target.teamId }, to: parsed.data },
  });

  return NextResponse.json({ message: "User updated" });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getApiAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "You cannot delete your own account here — use Settings." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.user.delete({ where: { id } });
  await recordAuditEvent({ actorUserId: admin.id, action: "admin.user_deleted", targetType: "User", targetId: id });

  return NextResponse.json({ message: "User deleted" });
}
