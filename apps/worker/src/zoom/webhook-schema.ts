import { z } from "zod";

/**
 * Zoom webhook payloads share this basic envelope across event types; the
 * `object` shape varies per event, so we keep it loose and pull specific
 * fields out per-handler rather than modeling every event exhaustively.
 */
export const zoomWebhookEnvelopeSchema = z.object({
  event: z.string(),
  event_ts: z.number(),
  payload: z.object({
    account_id: z.string().optional(),
    object: z.record(z.string(), z.unknown()),
  }),
});

export type ZoomWebhookEnvelope = z.infer<typeof zoomWebhookEnvelopeSchema>;

export const zoomMeetingObjectSchema = z.object({
  id: z.union([z.string(), z.number()]),
  uuid: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

export const zoomRecordingFileSchema = z.object({
  id: z.string(),
  file_type: z.string(),
  file_size: z.number().optional(),
  recording_type: z.string().optional(),
  download_url: z.string().optional(),
});

export const zoomRecordingObjectSchema = z.object({
  id: z.union([z.string(), z.number()]),
  uuid: z.string().optional(),
  recording_files: z.array(zoomRecordingFileSchema).default([]),
});
