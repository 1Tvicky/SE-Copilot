import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@meeting-assistant/db";
import { canManageMeeting, meetingVisibilityWhere } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext } from "@/lib/api";

const updateSchema = z
  .object({
    status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "COMPLETED"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    owner: z.string().trim().max(200).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const item = await prisma.actionItem.findFirst({
    where: { id, meetingSession: meetingVisibilityWhere(ctx) },
    include: { meetingSession: { select: { userId: true, backupSeUserId: true, teamId: true } } },
  });
  if (!item) return jsonError(404, "Not found");
  if (!canManageMeeting(ctx, item.meetingSession)) return jsonError(403, "You can't change action items for this meeting.");

  const parsed = updateSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  // A manual edit makes the item the SE's: regenerating the analysis will no longer replace it.
  const updated = await prisma.actionItem.update({ where: { id }, data: { ...parsed.data, origin: "manual" } });
  return NextResponse.json(updated);
}
