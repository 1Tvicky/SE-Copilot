import { prisma } from "@meeting-assistant/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Fixed-window rate limiter backed by Postgres (one row per key), shared
 * across every web process. A single atomic upsert either starts a new window
 * or increments the current one. `key` should include the action and the
 * identity being limited, e.g. `signin:a@b.com`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ count: number; expires_at: Date }[]>`
    INSERT INTO rate_limit_buckets (key, count, "expiresAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets."expiresAt" <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
      "expiresAt" = CASE WHEN rate_limit_buckets."expiresAt" <= now()
        THEN now() + make_interval(secs => ${windowSeconds}) ELSE rate_limit_buckets."expiresAt" END
    RETURNING count, "expiresAt" AS expires_at`;
  const row = rows[0]!;
  // Opportunistic cleanup of long-expired buckets (cheap, indexed).
  if (Math.random() < 0.01) void prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3600_000) } } }).catch(() => undefined);
  return { allowed: row.count <= limit, remaining: Math.max(limit - row.count, 0), resetAt: row.expires_at };
}
