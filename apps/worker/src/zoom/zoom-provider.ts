import { prisma as defaultPrisma, applyMeetingTransition, type PrismaClient } from "@meeting-assistant/db";
import {
  ZOOM_CAPABILITIES,
  type MeetingInput,
  type MeetingProvider,
  type PreparationResult,
  type ProviderCapabilities,
  type JoinResult,
  type SessionInput,
  type SessionStatus,
  type ValidationResult,
} from "@meeting-assistant/shared";
import { getZoomAccessToken } from "./oauth.js";
import { logger } from "../logger.js";

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const MEETING_URL_PATTERN = /\/(?:j|s)\/(\d+)/;

export function extractMeetingIdFromUrl(url: string): string | null {
  const match = url.match(MEETING_URL_PATTERN);
  return match?.[1] ?? null;
}

const JOIN_UNSUPPORTED_REASON =
  "Automated participant join is not implemented in v1 — see getSupportedCapabilities().limitations.";

/**
 * Implements MeetingProvider against Zoom's officially-supported REST API
 * (Server-to-Server OAuth). Important limitation: an S2S OAuth app can only
 * see resources that belong to the SAME Zoom account it's installed under —
 * it cannot look up or act on an arbitrary third party's meeting just from a
 * pasted URL. This app is meant to be installed under the organization
 * whose meetings it manages, not used as a generic "any Zoom link" tool.
 */
export class ZoomProvider implements MeetingProvider {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async validateMeeting(input: MeetingInput): Promise<ValidationResult> {
    const meetingId = input.meetingId ?? extractMeetingIdFromUrl(input.meetingUrl);
    if (!meetingId) {
      return { valid: false, errors: ["Could not determine a Zoom meeting ID from the URL or meetingId field"] };
    }

    try {
      const token = await getZoomAccessToken();
      const res = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        return {
          valid: false,
          errors: [
            "Zoom could not find a meeting with this ID under this app's connected Zoom account. " +
              "This app can only manage meetings created within its own organization's Zoom account.",
          ],
        };
      }
      if (!res.ok) {
        return { valid: false, errors: [`Zoom API returned status ${res.status}`] };
      }

      const data = (await res.json()) as { id: number };
      return { valid: true, normalizedMeetingId: String(data.id), hostAccountConnected: true };
    } catch (err) {
      logger.error({ err }, "Zoom meeting validation failed");
      return {
        valid: false,
        errors: [err instanceof Error ? err.message : "Unknown error validating the meeting"],
      };
    }
  }

  async prepareSession(_input: SessionInput): Promise<PreparationResult> {
    return {
      supported: true,
      ready: true,
      recordingWillBeAvailable: true,
      notes:
        "No bot joins the meeting. Once the host starts Zoom cloud recording, this session will " +
        "automatically pick up the recording via webhook after the meeting ends.",
    };
  }

  async joinSession(): Promise<JoinResult> {
    return { supported: false, reason: JOIN_UNSUPPORTED_REASON };
  }

  async leaveSession(): Promise<void> {
    // No-op: v1 never has a live joined session to leave.
  }

  async cancelSession(sessionId: string): Promise<void> {
    const result = await applyMeetingTransition(this.db, {
      meetingSessionId: sessionId,
      toStatus: "CANCELLED",
      source: "WORKER",
      message: "Cancelled via provider",
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const meeting = await this.db.meetingSession.findUnique({
      where: { id: sessionId },
      select: { status: true, updatedAt: true },
    });
    if (!meeting) {
      return { platformStatus: "unknown" };
    }

    const platformStatus =
      meeting.status === "ACTIVE" || meeting.status === "RECORDING"
        ? "started"
        : meeting.status === "COMPLETED" || meeting.status === "PROCESSING"
          ? "ended"
          : meeting.status === "SCHEDULED" || meeting.status === "PREPARING"
            ? "scheduled"
            : "unknown";

    return { platformStatus, lastEventAt: meeting.updatedAt };
  }

  getSupportedCapabilities(): ProviderCapabilities {
    return ZOOM_CAPABILITIES;
  }
}
