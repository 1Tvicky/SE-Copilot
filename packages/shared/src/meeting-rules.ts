import type { DetectedPlatform } from "./platform-detection.js";
import { isJoinableMeetingUrl } from "./platform-detection.js";

export const MEETING_TYPES = [
  "CUSTOMER_DISCOVERY",
  "TECHNICAL_DISCUSSION",
  "DEMO",
  "POC",
  "MIGRATION_DISCUSSION",
  "ARCHITECTURE_DISCUSSION",
  "PRESALES",
  "INTERNAL",
  "OTHER",
] as const;
export type MeetingTypeValue = (typeof MEETING_TYPES)[number];

export const MEETING_TYPE_LABELS: Record<MeetingTypeValue, string> = {
  CUSTOMER_DISCOVERY: "Customer discovery",
  TECHNICAL_DISCUSSION: "Technical discussion",
  DEMO: "Demo",
  POC: "POC",
  MIGRATION_DISCUSSION: "Migration discussion",
  ARCHITECTURE_DISCUSSION: "Architecture discussion",
  PRESALES: "Presales",
  INTERNAL: "Internal",
  OTHER: "Other",
};

// ---------------------------------------------------------------------------
// Participants / customer detection
// ---------------------------------------------------------------------------

/** Consumer mail domains never identify a customer company. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** Internal = the domain, or a subdomain of it, is in the team's internal domain list. */
export function isInternalEmail(email: string, internalDomains: readonly string[]): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return internalDomains.some((d) => {
    const internal = d.trim().toLowerCase();
    return internal.length > 0 && (domain === internal || domain.endsWith(`.${internal}`));
  });
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * The customer's email domains: every external, non-free-mail attendee domain,
 * most frequent first. An empty result means no identifiable customer company.
 */
export function detectCustomerDomains(emails: readonly string[], internalDomains: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const email of emails) {
    if (isInternalEmail(email, internalDomains)) continue;
    const domain = emailDomain(email);
    if (!domain || isFreeMailDomain(domain)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
}

/** "contoso.co.uk" -> "Contoso". A starting point the SE can rename. */
export function customerNameFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
  let label = parts[0] ?? domain;
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2] ?? "")) {
    label = parts[parts.length - 3] ?? label;
  } else if (parts.length >= 2) {
    label = parts[parts.length - 2] ?? label;
  }
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface ClassificationInput {
  subject: string;
  body?: string | null;
  /** Whether at least one attendee is outside the team's internal domains. */
  hasExternalParticipants: boolean;
}

// Order matters: the first rule whose pattern matches the subject wins, then the body is tried.
const CLASSIFICATION_RULES: { type: MeetingTypeValue; pattern: RegExp }[] = [
  { type: "POC", pattern: /\b(poc|proof[\s-]of[\s-]concept|pilot)\b/i },
  { type: "DEMO", pattern: /\b(demo|demonstration|walk[\s-]?through|product tour)\b/i },
  { type: "ARCHITECTURE_DISCUSSION", pattern: /\b(architecture|solution design|design review|technical design)\b/i },
  { type: "MIGRATION_DISCUSSION", pattern: /\b(migrat\w*|cut[\s-]?over|tenant[\s-]to[\s-]tenant|t2t|onboarding plan)\b/i },
  { type: "TECHNICAL_DISCUSSION", pattern: /\b(technical|deep[\s-]?dive|tech (call|sync|session)|troubleshoot\w*|q&a|integration)\b/i },
  { type: "CUSTOMER_DISCOVERY", pattern: /\b(discovery|intro(duction)?|kick[\s-]?off|requirements?|scoping|initial (call|meeting)|getting to know)\b/i },
];

/**
 * Keyword classification of a meeting from its invite. Internal-only meetings
 * are always INTERNAL; an external meeting that matches no rule is PRESALES
 * (customer-facing, type unknown). The SE can override either way.
 */
export function classifyMeeting(input: ClassificationInput): MeetingTypeValue {
  if (!input.hasExternalParticipants) return "INTERNAL";
  for (const text of [input.subject, input.body ?? ""]) {
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(text)) return rule.type;
    }
  }
  return "PRESALES";
}

// ---------------------------------------------------------------------------
// Notetaker eligibility
// ---------------------------------------------------------------------------

export interface EligibilitySettings {
  botEnabled: boolean;
  botEligibleTypes: readonly MeetingTypeValue[];
  noAiMarkers: readonly string[];
  /** Whether the bot provider is configured (API key present). */
  botProviderConfigured: boolean;
}

export interface EligibilityInput {
  meetingType: MeetingTypeValue;
  platform: DetectedPlatform;
  meetingUrl: string | null;
  subject: string;
  body?: string | null;
  /** Outlook "private" sensitivity: treat as personal. */
  isPrivate?: boolean;
  isCancelled?: boolean;
  endsAt?: Date | null;
  /** SE override: true = always join, false = never join, null/undefined = follow rules. */
  override?: boolean | null;
  now?: Date;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Human-readable reason when not eligible (or when an override forced it). */
  reason: string | null;
}

export function findNoAiMarker(text: string, markers: readonly string[]): string | null {
  const haystack = text.toLowerCase();
  for (const marker of markers) {
    const m = marker.trim().toLowerCase();
    if (m && haystack.includes(m)) return marker;
  }
  return null;
}

/**
 * Decides whether the AI notetaker should join. Hard blockers (cancelled,
 * already over, no joinable URL, unsupported platform, provider not set up)
 * apply even with an override: an override can't make a bot join a meeting it
 * physically cannot join. Soft rules (type, "No AI" marker, personal) are what
 * an SE override bypasses.
 */
export function evaluateBotEligibility(input: EligibilityInput, settings: EligibilitySettings): EligibilityResult {
  const now = input.now ?? new Date();

  if (input.isCancelled) return { eligible: false, reason: "Meeting was cancelled" };
  if (input.endsAt && input.endsAt.getTime() <= now.getTime()) return { eligible: false, reason: "Meeting has already ended" };
  if (input.platform !== "ZOOM" && input.platform !== "TEAMS") {
    return {
      eligible: false,
      reason: input.platform === "OTHER" ? "Unsupported meeting platform (only Zoom and Microsoft Teams are supported)" : "No Zoom or Teams meeting link found",
    };
  }
  if (!isJoinableMeetingUrl(input.platform, input.meetingUrl)) return { eligible: false, reason: "No valid meeting URL" };
  if (!settings.botProviderConfigured) return { eligible: false, reason: "Notetaker provider is not configured" };

  if (input.override === false) return { eligible: false, reason: "Notetaker turned off for this meeting by the SE" };
  if (input.override === true) return { eligible: true, reason: "Notetaker turned on for this meeting by the SE" };

  if (!settings.botEnabled) return { eligible: false, reason: "Auto-join is disabled in team settings" };
  const marker = findNoAiMarker(`${input.subject}\n${input.body ?? ""}`, settings.noAiMarkers);
  if (marker) return { eligible: false, reason: `Invite is marked "${marker}"` };
  if (input.isPrivate) return { eligible: false, reason: "Private/personal meeting" };
  if (!settings.botEligibleTypes.includes(input.meetingType)) {
    return { eligible: false, reason: `${MEETING_TYPE_LABELS[input.meetingType]} meetings are excluded by the eligibility rules` };
  }
  return { eligible: true, reason: null };
}

/**
 * When the bot should join: `offsetMinutes` before start, but never in the
 * past. Returns null when the meeting is already in progress (join now).
 */
export function computeBotJoinAt(scheduledAt: Date, offsetMinutes: number, now: Date = new Date()): Date | null {
  const joinAt = new Date(scheduledAt.getTime() - offsetMinutes * 60_000);
  return joinAt.getTime() > now.getTime() ? joinAt : null;
}
