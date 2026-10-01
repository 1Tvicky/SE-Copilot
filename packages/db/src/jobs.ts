import { PgBoss, type SendOptions } from "pg-boss";
import { ALL_QUEUE_NAMES, QUEUE_NAMES, type QueueName } from "@meeting-assistant/shared";

/**
 * pg-boss job queue on the app's own Postgres database (schema "pgboss").
 * Replaces BullMQ/Redis: one less piece of infrastructure, and jobs share
 * the database's durability and backups.
 *
 * Per-queue retry policy lives here so producers never have to repeat it.
 */
const QUEUE_POLICY: Record<QueueName, { retryLimit: number; retryDelay: number; retryBackoff: boolean; expireInSeconds: number }> = {
  [QUEUE_NAMES.calendarSync]: { retryLimit: 1, retryDelay: 30, retryBackoff: false, expireInSeconds: 5 * 60 },
  [QUEUE_NAMES.botSchedule]: { retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 2 * 60 },
  [QUEUE_NAMES.botEvents]: { retryLimit: 4, retryDelay: 5, retryBackoff: true, expireInSeconds: 2 * 60 },
  [QUEUE_NAMES.botTranscript]: { retryLimit: 6, retryDelay: 30, retryBackoff: true, expireInSeconds: 5 * 60 },
  [QUEUE_NAMES.captureTimeout]: { retryLimit: 2, retryDelay: 30, retryBackoff: false, expireInSeconds: 60 },
  [QUEUE_NAMES.zoomWebhookEvents]: { retryLimit: 2, retryDelay: 5, retryBackoff: true, expireInSeconds: 2 * 60 },
  [QUEUE_NAMES.transcription]: { retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 30 * 60 },
  [QUEUE_NAMES.meetingAnalysis]: { retryLimit: 2, retryDelay: 20, retryBackoff: true, expireInSeconds: 15 * 60 },
  // Sending is not blindly retried: a timeout after Graph accepted the
  // message would double-send to a customer. Failures surface to the SE.
  [QUEUE_NAMES.emailSend]: { retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 2 * 60 },
};

export function getQueuePolicy(name: QueueName) {
  return QUEUE_POLICY[name];
}

declare global {
  var __jobQueue: Promise<PgBoss> | undefined;
}

export interface JobQueueOptions {
  /** Workers run maintenance + cron; producers (the web app) do neither. */
  role: "producer" | "worker";
}

async function createJobQueue({ role }: JobQueueOptions): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const boss = new PgBoss({
    connectionString,
    max: role === "worker" ? 10 : 4,
    supervise: role === "worker",
    schedule: role === "worker",
  });
  boss.on("error", (err) => console.error("[jobs] pg-boss error", err));
  await boss.start();
  for (const name of ALL_QUEUE_NAMES) {
    const existing = await boss.getQueue(name);
    if (!existing) await boss.createQueue(name, QUEUE_POLICY[name]);
  }
  return boss;
}

/** Process-wide queue client, started on first use and reused across hot reloads. */
export function getJobQueue(options: JobQueueOptions = { role: "producer" }): Promise<PgBoss> {
  if (!globalThis.__jobQueue) {
    globalThis.__jobQueue = createJobQueue(options).catch((err) => {
      // Don't cache a failed start: the next call should retry.
      globalThis.__jobQueue = undefined;
      throw err;
    });
  }
  return globalThis.__jobQueue;
}

/**
 * Enqueue a job. `singletonKey` collapses duplicates of the same logical job
 * (e.g. two calendar syncs that both want to reschedule one meeting's bot).
 */
export async function enqueueJob<T extends object>(name: QueueName, data: T, options: SendOptions = {}): Promise<string | null> {
  const boss = await getJobQueue();
  return boss.send(name, data, options);
}

export async function stopJobQueue(): Promise<void> {
  const pending = globalThis.__jobQueue;
  globalThis.__jobQueue = undefined;
  if (pending) {
    const boss = await pending.catch(() => null);
    await boss?.stop({ graceful: true, timeout: 10_000 });
  }
}
