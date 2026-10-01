import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { meetingNoteSchema } from "@meeting-assistant/shared";
import { invalidInput, jsonError, readJson, requireApiContext, requireManageableMeeting } from "@/lib/api";

type RouteParams = { params: Promise<{ id: string; noteId: string }> };

async function load(params: RouteParams["params"]) {
  const ctx = await requireApiContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id, noteId } = await params;
  const meeting = await requireManageableMeeting(ctx, id);
  if (meeting instanceof NextResponse) return meeting;
  const note = await prisma.meetingNote.findFirst({ where: { id: noteId, meetingSessionId: id } });
  if (!note) return jsonError(404, "Note not found");
  return note;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const note = await load(params);
  if (note instanceof NextResponse) return note;
  const parsed = meetingNoteSchema.partial().safeParse(await readJson(request));
  if (!parsed.success) return invalidInput(parsed.error);
  const updated = await prisma.meetingNote.update({ where: { id: note.id }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const note = await load(params);
  if (note instanceof NextResponse) return note;
  await prisma.meetingNote.delete({ where: { id: note.id } });
  return NextResponse.json({ ok: true });
}
