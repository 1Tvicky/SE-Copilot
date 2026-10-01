import { prisma } from "@meeting-assistant/db";

export interface WorkerHeartbeat {
  workerId: string;
  startedAt: string;
  pid: number;
  lastBeatAt: string;
}

/** Workers refresh their row every 10s (apps/worker/src/health.ts); anything silent for 30s is considered dead. */
export async function listActiveWorkers(): Promise<WorkerHeartbeat[]> {
  const rows = await prisma.workerHeartbeat.findMany({ where: { lastBeatAt: { gte: new Date(Date.now() - 30_000) } } });
  return rows.map((r) => ({ workerId: r.workerId, pid: r.pid, startedAt: r.startedAt.toISOString(), lastBeatAt: r.lastBeatAt.toISOString() }));
}
