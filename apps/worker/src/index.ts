import "./env.js";

import { getJobQueue, prisma, stopJobQueue } from "@meeting-assistant/db";
import { QUEUE_NAMES, type CalendarSyncJobData } from "@meeting-assistant/shared";
import { logger } from "./logger.js";
import { startHeartbeat } from "./health.js";
import { registerWorker } from "./jobs.js";
import { processCalendarSync } from "./processors/calendar-sync.js";
import { processBotSchedule } from "./processors/bot-schedule.js";
import { processBotEvent } from "./processors/bot-events.js";
import { processBotTranscript } from "./processors/bot-transcript.js";
import { processCaptureTimeout } from "./processors/capture-timeout.js";
import { processZoomWebhookEvent } from "./processors/webhook-events.js";
import { processTranscriptionJob } from "./processors/transcription.js";
import { processMeetingAnalysis } from "./processors/meeting-analysis.js";
import { processEmailSend } from "./processors/email-send.js";

async function main() {
  const boss = await getJobQueue({ role: "worker" });
  const heartbeat = startHeartbeat();
  logger.info({ workerId: heartbeat.workerId }, "Worker starting");

  await registerWorker(boss, QUEUE_NAMES.calendarSync, processCalendarSync, { localConcurrency: 1 });
  await registerWorker(boss, QUEUE_NAMES.botSchedule, processBotSchedule, { localConcurrency: 3 });
  await registerWorker(boss, QUEUE_NAMES.botEvents, processBotEvent, { localConcurrency: 5 });
  await registerWorker(boss, QUEUE_NAMES.botTranscript, processBotTranscript, { localConcurrency: 2 });
  await registerWorker(boss, QUEUE_NAMES.captureTimeout, processCaptureTimeout, { localConcurrency: 2 });
  await registerWorker(boss, QUEUE_NAMES.zoomWebhookEvents, processZoomWebhookEvent, { localConcurrency: 5 });
  // Downloading + transcribing a whole recording is slow and memory-heavy.
  await registerWorker(boss, QUEUE_NAMES.transcription, processTranscriptionJob, { localConcurrency: 1 });
  await registerWorker(boss, QUEUE_NAMES.meetingAnalysis, processMeetingAnalysis, { localConcurrency: 2 });
  await registerWorker(boss, QUEUE_NAMES.emailSend, processEmailSend, { localConcurrency: 2 });

  // Poll the team calendars. Graph change notifications would be lower
  // latency but need a public HTTPS endpoint and subscription renewal; a
  // short poll is simpler and plenty for "join 1 minute before start".
  const syncCron = process.env.CALENDAR_SYNC_CRON ?? "*/5 * * * *";
  await boss.schedule(QUEUE_NAMES.calendarSync, syncCron, {} satisfies CalendarSyncJobData);
  logger.info({ syncCron }, "Worker ready");

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down worker gracefully");
    await heartbeat.stop();
    await stopJobQueue();
    await prisma.$disconnect();
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});
