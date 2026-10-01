import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { meetingNoteSchema } from "@meeting-assistant/shared";
import { findVisibleMeeting } from "@/lib/access";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await findVisibleMeeting(ctx, id);
  if (!meeting) return jsonError(404, "Not found");
  const notes = await prisma.meetingNote.findMany({
    where: { meetingSessionId: id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ items: notes });
}

export async function POST(request: Request, { params }: RouteParams) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;
  if (meeting.status === "CANCELLED") return jsonError(409, "This meeting was cancelled.");

  const parsed = meetingNoteSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const note = await prisma.meetingNote.create({
    data: { meetingSessionId: id, authorUserId: ctx.user.id, category: parsed.data.category, text: parsed.data.text },
    include: { author: { select: { id: true, name: true } } },
  });
  return NextResponse.json(note, { status: 201 });
}
