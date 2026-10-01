import { randomUUID } from "node:crypto";
import { prisma } from "@meeting-assistant/db";
import { logger } from "./logger.js";

const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Each worker process upserts its row every 10s. The admin panel treats a
 * row not refreshed in the last 30s as a dead worker; rows older than a day
 * are pruned here.
 */
export function startHeartbeat(): { workerId: string; stop: () => Promise<void> } {
  const workerId = randomUUID();
  const startedAt = new Date();

  async function beat() {
    try {
      await prisma.workerHeartbeat.upsert({
        where: { workerId },
        update: { lastBeatAt: new Date() },
        create: { workerId, pid: process.pid, startedAt, lastBeatAt: new Date() },
      });
    } catch (err) {
      logger.warn({ err }, "Heartbeat write failed");
    }
  }

  void beat();
  void prisma.workerHeartbeat.deleteMany({ where: { lastBeatAt: { lt: new Date(Date.now() - 24 * 3600_000) } } }).catch(() => undefined);
  const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);

  return {
    workerId,
    stop: async () => {
      clearInterval(interval);
      await prisma.workerHeartbeat.delete({ where: { workerId } }).catch(() => undefined);
    },
  };
}
