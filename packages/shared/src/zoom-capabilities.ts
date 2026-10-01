import type { ProviderCapabilities } from "./provider.js";

/**
 * The single source of truth for what the Zoom integration actually
 * supports in v1 (see the "Recording/webhook-first" decision in the
 * project's architecture doc). Consumed by: the db seed script (persists it
 * onto the meeting_providers row), the web app (grays out unsupported
 * options in the create-meeting form), and the worker's ZoomProvider
 * (returned verbatim from getSupportedCapabilities()).
 */
export const ZOOM_CAPABILITIES: ProviderCapabilities = {
  platform: "zoom",
  canValidateMeeting: true,
  canScheduleMeeting: true,
  canJoinAsParticipant: false,
  canPlayMediaAsParticipant: false,
  canFetchCloudRecording: true,
  canReceiveWebhookLifecycleEvents: true,
  limitations: [
    "Automated participant join requires Zoom's Meeting SDK, Marketplace app review, and (since Feb 2026) an OBF token to join meetings this app did not create. Not implemented in v1.",
    "Media playback impersonating a live participant is out of scope: it conflicts with this product's anti-impersonation and attendance-integrity rules.",
    "Cloud recording fetch requires the meeting host to have cloud recording enabled on their Zoom account.",
  ],
};
