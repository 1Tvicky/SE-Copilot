/**
 * Pluggable transcription/summarization providers, mirroring the
 * MeetingProvider pattern: swap the implementation without touching
 * callers, and never claim a capability the concrete implementation
 * doesn't actually have.
 */

export interface TranscriptSegmentInput {
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  language: string | null;
  segments: TranscriptSegmentInput[];
  /** Whether this provider distinguishes speakers. If false, speakerLabel is always null. */
  supportsSpeakerLabels: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribeAudio(input: { audioBuffer: Buffer; mimeType: string }): Promise<TranscriptionResult>;
}

export interface MeetingSummaryContent {
  overview: string;
  topics: string[];
  decisions: string[];
  actionItems: string[];
  questions: string[];
  keyTimestamps: { label: string; timestampMs: number }[];
}

export interface SummaryProvider {
  readonly name: string;
  summarizeTranscript(input: { meetingName: string; transcriptText: string }): Promise<MeetingSummaryContent>;
}
