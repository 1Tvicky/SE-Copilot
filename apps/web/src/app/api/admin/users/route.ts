import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { getApiAdmin } from "@/lib/session";

export async function GET(request: Request) {
  const admin = await getApiAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = new URL(request.url).searchParams.get("q")?.trim();

  const users = await prisma.user.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      teamId: true,
      createdAt: true,
      _count: { select: { meetingSessions: true } },
    },
  });

  const teams = await prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ users, teams });
}
