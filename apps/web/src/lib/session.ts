import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Next.js 16 moved auth out of proxy.ts/middleware (network-boundary routing
 * only, no auth) and back into layouts/route handlers, so every protected
 * route group calls one of these from its layout instead of relying on a
 * central middleware gate.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return session;
}

export async function requireUser(callbackPath?: string): Promise<Session["user"]> {
  const session = await getCurrentSession();
  if (!session) {
    const target = callbackPath ? `/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}` : "/sign-in";
    redirect(target);
  }
  return session.user;
}

export async function requireAdmin(): Promise<Session["user"]> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    redirect("/dashboard");
  }
  return user;
}

/** Route-handler variant: never redirects (there's no page to redirect from), just returns null. */
export async function getApiUser(): Promise<Session["user"] | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

/** Like getApiUser, but also exposes the session's opaque sessionId claim for session-management endpoints. */
export async function getApiSession(): Promise<{ user: Session["user"]; sessionId?: string } | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  return { user: session.user, sessionId: session.sessionId };
}

/** Route-handler variant of requireAdmin: returns null instead of redirecting for a page. */
export async function getApiAdmin(): Promise<Session["user"] | null> {
  const user = await getApiUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}
