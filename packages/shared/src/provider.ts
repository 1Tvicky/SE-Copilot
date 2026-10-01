/**
 * Platform integration abstraction. A provider only claims a capability it
 * genuinely implements against an official, authorized API — see
 * ProviderCapabilities. Callers must check capabilities before invoking a
 * method that a provider doesn't support; unsupported methods return an
 * UnsupportedResult rather than pretending to succeed.
 */

export type MeetingPlatform = "zoom";

export interface MeetingInput {
  platform: MeetingPlatform;
  meetingUrl: string;
  meetingId?: string;
  passcode?: string;
}

export interface ValidationResult {
  valid: boolean;
  normalizedMeetingId?: string;
  hostAccountConnected?: boolean;
  errors?: string[];
}

export interface SessionInput {
  meetingSessionId: string;
  platform: MeetingPlatform;
  meetingUrl: string;
  meetingId?: string;
  /** Never plaintext at rest; decrypted only in-process for the duration of the call. */
  passcode?: string;
  participantDisplayName: string;
  maxDurationMinutes: number;
}

export type UnsupportedResult = {
  supported: false;
  reason: string;
};

export type PreparationResult =
  | ({ supported: true } & {
      ready: boolean;
      recordingWillBeAvailable: boolean;
      notes?: string;
    })
  | UnsupportedResult;

export type JoinResult =
  | ({ supported: true } & {
      externalSessionRef: string;
    })
  | UnsupportedResult;

export interface SessionStatus {
  platformStatus: "unknown" | "scheduled" | "started" | "ended" | "recording_available";
  lastEventAt?: Date;
  raw?: Record<string, unknown>;
}

/**
 * What a provider genuinely supports today, so the frontend and worker can
 * gray out / clearly label capabilities instead of silently no-oping.
 */
export interface ProviderCapabilities {
  platform: MeetingPlatform;
  canValidateMeeting: boolean;
  canScheduleMeeting: boolean;
  canJoinAsParticipant: boolean;
  canPlayMediaAsParticipant: boolean;
  canFetchCloudRecording: boolean;
  canReceiveWebhookLifecycleEvents: boolean;
  /** Human-readable notes surfaced in the UI/docs for anything false above. */
  limitations: string[];
}

export interface MeetingProvider {
  validateMeeting(input: MeetingInput): Promise<ValidationResult>;
  prepareSession(input: SessionInput): Promise<PreparationResult>;
  joinSession(input: SessionInput): Promise<JoinResult>;
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  leaveSession(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  getSupportedCapabilities(): ProviderCapabilities;
}
