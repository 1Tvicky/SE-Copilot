import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { getApiSession } from "@/lib/session";
import { hashSessionId } from "@/lib/session-hash";

export async function GET() {
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const currentHash = session.sessionId ? hashSessionId(session.sessionId) : null;

  const sessions = await prisma.userSession.findMany({
    where: { userId: session.user.id, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, sessionIdHash: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });

  return NextResponse.json(
    sessions.map(({ sessionIdHash, ...rest }) => ({
      ...rest,
      isCurrent: sessionIdHash === currentHash,
    })),
  );
}
