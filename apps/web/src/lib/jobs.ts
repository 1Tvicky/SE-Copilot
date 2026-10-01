import { enqueueJob } from "@meeting-assistant/db";
import type { QueueName } from "@meeting-assistant/shared";
import type { SendOptions } from "pg-boss";
import { withTimeout } from "@/lib/with-timeout";

/**
 * Enqueue from a request handler with a hard deadline, so a database hiccup
 * degrades to a fast error instead of a hung request.
 */
export function enqueue<T extends object>(name: QueueName, data: T, options: SendOptions = {}): Promise<string | null> {
  return withTimeout(enqueueJob(name, data, options), 8_000, `Timed out enqueueing ${name} job`);
}
