import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Reuse a single PrismaClient across Next.js hot reloads / module reloads.
 * Without this, dev-mode reloading creates a new connection pool on every
 * edit and eventually exhausts Postgres connections.
 */
export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
