import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { QueueName } from "@meeting-assistant/shared";
import { prisma } from "@meeting-assistant/db";
import { logger } from "./logger.js";

/** What every processor receives: the payload plus enough retry metadata to know if this is the last attempt. */
export interface JobContext<T> {
  id: string;
  name: QueueName;
  data: T;
  retryCount: number;
  retryLimit: number;
}

export type JobHandler<T> = (job: JobContext<T>) => Promise<void>;

/**
 * Registers a pg-boss worker for one queue and mirrors each job's lifecycle
 * into background_jobs so the admin panel can show it. Mirroring is
 * best-effort and never affects the job itself.
 */
export async function registerWorker<T extends object>(
  boss: PgBoss,
  name: QueueName,
  handler: JobHandler<T>,
  options: { localConcurrency?: number } = {},
): Promise<void> {
  await boss.work(
    name,
    { includeMetadata: true as const, batchSize: 1, localConcurrency: options.localConcurrency ?? 2 },
    async (jobs: JobWithMetadata<T>[]) => {
      for (const job of jobs) {
        const ctx: JobContext<T> = { id: job.id, name, data: job.data, retryCount: job.retryCount, retryLimit: job.retryLimit };
        await mirror(ctx, "ACTIVE");
        try {
          await handler(ctx);
          await mirror(ctx, "COMPLETED");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, queue: name, jobId: job.id, retryCount: job.retryCount }, "Job failed");
          await mirror(ctx, "FAILED", message);
          throw err;
        }
      }
    },
  );
}

async function mirror<T>(job: JobContext<T>, status: "ACTIVE" | "COMPLETED" | "FAILED", error?: string) {
  const meetingSessionId = (job.data as { meetingSessionId?: unknown }).meetingSessionId;
  try {
    await prisma.backgroundJob.upsert({
      where: { queueName_jobId: { queueName: job.name, jobId: job.id } },
      update: {
        status,
        attemptsMade: job.retryCount + 1,
        ...(status === "ACTIVE" ? { startedAt: new Date() } : { finishedAt: new Date() }),
        ...(error ? { lastError: error.slice(0, 2000) } : {}),
      },
      create: {
        queueName: job.name,
        jobId: job.id,
        jobType: job.name,
        status,
        attemptsMade: job.retryCount + 1,
        maxAttempts: job.retryLimit + 1,
        startedAt: new Date(),
        meetingSessionId: typeof meetingSessionId === "string" ? meetingSessionId : undefined,
        lastError: error?.slice(0, 2000),
      },
    });
  } catch (err) {
    logger.warn({ err, jobId: job.id }, "Failed to mirror job state");
  }
}
