import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { getApiAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

const patchSchema = z.object({ isEnabled: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getApiAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  await prisma.meetingProviderRecord.update({ where: { id }, data: { isEnabled: parsed.data.isEnabled } });
  await recordAuditEvent({
    actorUserId: admin.id,
    action: "admin.provider_toggled",
    targetType: "MeetingProviderRecord",
    targetId: id,
    metadata: { isEnabled: parsed.data.isEnabled },
  });

  return NextResponse.json({ message: "Updated" });
}
