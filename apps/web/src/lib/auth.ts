import { randomUUID } from "node:crypto";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import AzureADProvider from "next-auth/providers/azure-ad";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@meeting-assistant/db";
import { signInSchema } from "@meeting-assistant/shared";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { hashSessionId } from "@/lib/session-hash";
import { onboardNewUser } from "@/lib/team-membership";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
/** How often the jwt callback re-checks tokenVersion/deletion against the DB. */
const REVALIDATE_INTERVAL_SECONDS = 5 * 60;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    // Required by the Credentials provider — NextAuth cannot persist
    // credentials-based sessions via the adapter, so revocation is handled
    // ourselves via User.tokenVersion + the user_sessions audit table below.
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    // Microsoft Entra ID (work accounts). Only offered when configured; the
    // tenant id pins sign-in to the organization's own directory.
    ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID
      ? [
          AzureADProvider({
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            tenantId: process.env.MICROSOFT_TENANT_ID,
          }),
        ]
      : []),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : []),
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const limit = await rateLimit(`signin:${email}`, 10, 15 * 60);
        if (!limit.allowed) {
          throw new Error("Too many sign-in attempts. Try again in a few minutes.");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash || user.deletedAt) {
          return null;
        }

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) {
          await recordAuditEvent({ actorUserId: user.id, action: "auth.signin.failed" });
          return null;
        }

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        // Fresh sign-in: mint a new tracked session row.
        token.id = user.id;
        token.role = user.role;

        const sessionId = randomUUID();
        token.sessionId = sessionId;
        token.tokenVersion = (
          await prisma.user.findUnique({ where: { id: user.id }, select: { tokenVersion: true } })
        )?.tokenVersion ?? 0;
        token.lastValidatedAt = Date.now();

        await prisma.userSession.create({
          data: {
            userId: user.id,
            sessionIdHash: hashSessionId(sessionId),
            expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
          },
        });
        return token;
      }

      const lastValidatedAt = typeof token.lastValidatedAt === "number" ? token.lastValidatedAt : 0;
      const dueForRevalidation = Date.now() - lastValidatedAt > REVALIDATE_INTERVAL_SECONDS * 1000;

      if (trigger === "update" || dueForRevalidation) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { tokenVersion: true, role: true, deletedAt: true },
        });
        const sessionHash = typeof token.sessionId === "string" ? hashSessionId(token.sessionId) : undefined;
        const sessionRecord = sessionHash
          ? await prisma.userSession.findUnique({ where: { sessionIdHash: sessionHash } })
          : null;

        const revoked =
          !dbUser ||
          dbUser.deletedAt !== null ||
          dbUser.tokenVersion !== token.tokenVersion ||
          sessionRecord?.revokedAt != null;

        if (revoked) {
          token.revoked = true;
          return token;
        }

        token.role = dbUser.role;
        token.lastValidatedAt = Date.now();
        if (sessionRecord) {
          await prisma.userSession.update({
            where: { id: sessionRecord.id },
            data: { lastSeenAt: new Date() },
          });
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token.revoked) {
        // Signal an invalid session; the client-side session provider treats a
        // missing user as unauthenticated and redirects to sign-in.
        return { ...session, user: undefined as never, expires: new Date(0).toISOString() };
      }
      session.user = {
        id: token.id,
        role: token.role,
        name: session.user?.name ?? "",
        email: session.user?.email ?? "",
        image: session.user?.image,
      };
      session.sessionId = token.sessionId;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.email) await onboardNewUser(user.id, user.email);
    },
    async signIn({ user, isNewUser }) {
      await recordAuditEvent({
        actorUserId: user.id,
        action: isNewUser ? "auth.signup" : "auth.signin",
      });
    },
  },
};
