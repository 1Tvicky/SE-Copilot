/**
 * Works out which meeting platform a calendar event uses, and its join URL,
 * from the places a Zoom/Teams link can show up in an Outlook event: the
 * structured onlineMeeting.joinUrl, the location string, or the invite body
 * (Zoom's Outlook add-in and forwarded invites only put it in the body).
 */

export type DetectedPlatform = "ZOOM" | "TEAMS" | "OTHER" | "UNKNOWN";

export interface PlatformDetectionInput {
  onlineMeetingJoinUrl?: string | null;
  /** Graph's onlineMeetingProvider: "teamsForBusiness", "skypeForBusiness", "unknown", ... */
  onlineMeetingProvider?: string | null;
  location?: string | null;
  /** Plain text or HTML of the invite body. */
  body?: string | null;
}

export interface PlatformDetectionResult {
  platform: DetectedPlatform;
  meetingUrl: string | null;
  /** Zoom numeric meeting id, when the URL carries one. */
  zoomMeetingId: string | null;
}

// Zoom: https://zoom.us/j/123, https://acme.zoom.us/j/123?pwd=..., /s/ (start), /w/ (webinar),
// /my/<vanity> personal rooms, and zoomgov.com.
const ZOOM_URL = /https:\/\/(?:[a-z0-9-]+\.)*zoom(?:gov)?\.(?:us|com)\/(?:j|s|w|wc\/join|my)\/[^\s"'<>)\]]+/i;
// Teams: classic meetup-join links (often percent-encoded), the newer /meet/<id>?p= links, and Teams consumer.
const TEAMS_URL =
  /https:\/\/(?:teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/|teams\.live\.com\/meet\/|teams\.microsoft\.us\/l\/meetup-join\/)[^\s"'<>)\]]+/i;
// Platforms we can recognize but the MVP notetaker does not join.
const OTHER_URL =
  /https:\/\/(?:meet\.google\.com\/[a-z-]+|[a-z0-9-]+\.webex\.com\/[^\s"'<>)\]]+|[a-z0-9-]+\.gotomeeting\.com\/[^\s"'<>)\]]+|meet\.goto\.com\/[^\s"'<>)\]]+)/i;

/** Outlook HTML bodies wrap links in Safe Links and HTML-encode ampersands; undo both before matching. */
export function normalizeBodyForLinkSearch(body: string): string {
  let text = body.replace(/&amp;/g, "&").replace(/&#58;/g, ":");
  text = text.replace(/https:\/\/[a-z0-9.-]*safelinks\.protection\.outlook\.com\/\?url=([^&"'\s<>]+)[^\s"'<>]*/gi, (_, encoded: string) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
  return text;
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

export function extractZoomMeetingId(url: string): string | null {
  const match = /\/(?:j|s|w|wc\/join)\/(\d{9,11})/.exec(url);
  return match?.[1] ?? null;
}

export function detectMeetingPlatform(input: PlatformDetectionInput): PlatformDetectionResult {
  const candidates = [input.onlineMeetingJoinUrl, input.location, input.body ? normalizeBodyForLinkSearch(input.body) : null]
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  for (const text of candidates) {
    const teams = TEAMS_URL.exec(text);
    if (teams) return { platform: "TEAMS", meetingUrl: trimTrailingPunctuation(teams[0]), zoomMeetingId: null };
    const zoom = ZOOM_URL.exec(text);
    if (zoom) {
      const url = trimTrailingPunctuation(zoom[0]);
      return { platform: "ZOOM", meetingUrl: url, zoomMeetingId: extractZoomMeetingId(url) };
    }
  }

  // Graph says it's a Teams meeting but we could not find the link text
  // (rare; usually means the body was stripped). Treat as Teams without a URL
  // so eligibility reports "no valid meeting URL" rather than "unsupported".
  if (input.onlineMeetingProvider === "teamsForBusiness") {
    return { platform: "TEAMS", meetingUrl: null, zoomMeetingId: null };
  }

  for (const text of candidates) {
    const other = OTHER_URL.exec(text);
    if (other) return { platform: "OTHER", meetingUrl: trimTrailingPunctuation(other[0]), zoomMeetingId: null };
  }

  return { platform: "UNKNOWN", meetingUrl: null, zoomMeetingId: null };
}

/** True when the URL is a join link the notetaker can use for that platform. */
export function isJoinableMeetingUrl(platform: DetectedPlatform, url: string | null | undefined): boolean {
  if (!url) return false;
  if (platform === "ZOOM") return ZOOM_URL.test(url);
  if (platform === "TEAMS") return TEAMS_URL.test(url);
  return false;
}
