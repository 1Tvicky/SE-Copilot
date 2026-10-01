import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { getApiUser } from "@/lib/session";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await prisma.userSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.userSession.update({ where: { id }, data: { revokedAt: new Date() } });
  return NextResponse.json({ message: "Session revoked" });
}
