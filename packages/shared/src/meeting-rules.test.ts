import { describe, expect, it } from "vitest";
import { detectMeetingPlatform, extractZoomMeetingId } from "./platform-detection.js";
import {
  classifyMeeting,
  computeBotJoinAt,
  customerNameFromDomain,
  detectCustomerDomains,
  evaluateBotEligibility,
  isInternalEmail,
  type EligibilityInput,
  type EligibilitySettings,
} from "./meeting-rules.js";

describe("detectMeetingPlatform", () => {
  it("prefers Graph's structured Teams join URL", () => {
    const result = detectMeetingPlatform({
      onlineMeetingJoinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_xyz%40thread.v2/0?context=abc",
      onlineMeetingProvider: "teamsForBusiness",
    });
    expect(result.platform).toBe("TEAMS");
    expect(result.meetingUrl).toContain("teams.microsoft.com/l/meetup-join/");
  });

  it("finds a Zoom link in an HTML invite body, decoding &amp; and extracting the meeting id", () => {
    const result = detectMeetingPlatform({
      body: '<p>Join Zoom Meeting<br><a href="https://acme.zoom.us/j/98765432101?pwd=AbC&amp;from=addon">link</a></p>',
    });
    expect(result.platform).toBe("ZOOM");
    expect(result.meetingUrl).toBe("https://acme.zoom.us/j/98765432101?pwd=AbC&from=addon");
    expect(result.zoomMeetingId).toBe("98765432101");
  });

  it("unwraps Outlook Safe Links", () => {
    const wrapped =
      "https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fzoom.us%2Fj%2F1234567890&data=05%7C01";
    const result = detectMeetingPlatform({ body: `Join: ${wrapped}` });
    expect(result.platform).toBe("ZOOM");
    expect(result.meetingUrl).toBe("https://zoom.us/j/1234567890");
  });

  it("recognizes the newer teams.microsoft.com/meet links", () => {
    expect(detectMeetingPlatform({ location: "https://teams.microsoft.com/meet/2345678?p=abcdef" }).platform).toBe("TEAMS");
  });

  it("labels Google Meet / Webex as OTHER and plain events as UNKNOWN", () => {
    expect(detectMeetingPlatform({ body: "https://meet.google.com/abc-defg-hij" }).platform).toBe("OTHER");
    expect(detectMeetingPlatform({ location: "Conference room 4" }).platform).toBe("UNKNOWN");
  });

  it("strips trailing punctuation from a URL in prose", () => {
    expect(detectMeetingPlatform({ body: "Link: https://zoom.us/j/1234567890." }).meetingUrl).toBe("https://zoom.us/j/1234567890");
  });

  it("extractZoomMeetingId ignores personal-room vanity links", () => {
    expect(extractZoomMeetingId("https://zoom.us/my/jane.doe")).toBeNull();
  });
});

describe("participant / customer detection", () => {
  const internal = ["cloudfuze.com"];

  it("treats subdomains of an internal domain as internal", () => {
    expect(isInternalEmail("a@mail.cloudfuze.com", internal)).toBe(true);
    expect(isInternalEmail("a@notcloudfuze.com", internal)).toBe(false);
  });

  it("ranks external company domains by attendee count and ignores free-mail domains", () => {
    const domains = detectCustomerDomains(
      ["se@cloudfuze.com", "a@contoso.com", "b@contoso.com", "c@fabrikam.io", "d@gmail.com"],
      internal,
    );
    expect(domains).toEqual(["contoso.com", "fabrikam.io"]);
  });

  it("derives a readable customer name from a domain", () => {
    expect(customerNameFromDomain("contoso.com")).toBe("Contoso");
    expect(customerNameFromDomain("big-bank.co.uk")).toBe("Big Bank");
    expect(customerNameFromDomain("eu.globex.com")).toBe("Globex");
  });
});

describe("classifyMeeting", () => {
  const external = { hasExternalParticipants: true };

  it("classifies internal-only meetings as INTERNAL regardless of subject", () => {
    expect(classifyMeeting({ subject: "Demo prep", hasExternalParticipants: false })).toBe("INTERNAL");
  });

  it.each([
    ["Contoso | POC kickoff", "POC"],
    ["Product demo for Fabrikam", "DEMO"],
    ["Slack to Teams migration planning", "MIGRATION_DISCUSSION"],
    ["Solution architecture review", "ARCHITECTURE_DISCUSSION"],
    ["Technical deep dive - permissions", "TECHNICAL_DISCUSSION"],
    ["Intro call: CloudFuze <> Globex", "CUSTOMER_DISCOVERY"],
  ] as const)("%s -> %s", (subject, expected) => {
    expect(classifyMeeting({ subject, ...external })).toBe(expected);
  });

  it("falls back to the body, then to PRESALES", () => {
    expect(classifyMeeting({ subject: "CloudFuze <> Contoso", body: "Agenda: migration timeline", ...external })).toBe(
      "MIGRATION_DISCUSSION",
    );
    expect(classifyMeeting({ subject: "CloudFuze <> Contoso", ...external })).toBe("PRESALES");
  });
});

describe("evaluateBotEligibility", () => {
  const settings: EligibilitySettings = {
    botEnabled: true,
    botEligibleTypes: ["CUSTOMER_DISCOVERY", "DEMO", "POC", "PRESALES"],
    noAiMarkers: ["no ai", "#noai"],
    botProviderConfigured: true,
  };
  const now = new Date("2026-10-01T10:00:00Z");
  const base: EligibilityInput = {
    meetingType: "DEMO",
    platform: "ZOOM",
    meetingUrl: "https://zoom.us/j/1234567890",
    subject: "Demo",
    endsAt: new Date("2026-10-01T12:00:00Z"),
    now,
  };

  it("joins an eligible customer meeting", () => {
    expect(evaluateBotEligibility(base, settings)).toEqual({ eligible: true, reason: null });
  });

  it("skips internal meetings by default", () => {
    const r = evaluateBotEligibility({ ...base, meetingType: "INTERNAL" }, settings);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/Internal/);
  });

  it('honours "No AI" markers case-insensitively', () => {
    const r = evaluateBotEligibility({ ...base, subject: "Demo (NO AI please)" }, settings);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no ai/i);
  });

  it("skips private, cancelled and already-finished meetings", () => {
    expect(evaluateBotEligibility({ ...base, isPrivate: true }, settings).eligible).toBe(false);
    expect(evaluateBotEligibility({ ...base, isCancelled: true }, settings).eligible).toBe(false);
    expect(evaluateBotEligibility({ ...base, endsAt: new Date("2026-10-01T09:00:00Z") }, settings).eligible).toBe(false);
  });

  it("refuses unsupported platforms and missing URLs", () => {
    expect(evaluateBotEligibility({ ...base, platform: "OTHER", meetingUrl: "https://meet.google.com/x" }, settings).reason).toMatch(
      /Unsupported/,
    );
    expect(evaluateBotEligibility({ ...base, meetingUrl: null }, settings).reason).toMatch(/No valid meeting URL/);
  });

  it("lets an SE override soft rules but not hard blockers", () => {
    expect(evaluateBotEligibility({ ...base, meetingType: "INTERNAL", override: true }, settings).eligible).toBe(true);
    expect(evaluateBotEligibility({ ...base, override: false }, settings).eligible).toBe(false);
    expect(evaluateBotEligibility({ ...base, meetingUrl: null, override: true }, settings).eligible).toBe(false);
    expect(evaluateBotEligibility({ ...base, override: true }, { ...settings, botProviderConfigured: false }).eligible).toBe(false);
  });

  it("respects the team-wide auto-join switch", () => {
    expect(evaluateBotEligibility(base, { ...settings, botEnabled: false }).eligible).toBe(false);
  });
});

describe("computeBotJoinAt", () => {
  const now = new Date("2026-10-01T10:00:00Z");

  it("joins offset minutes before the start", () => {
    expect(computeBotJoinAt(new Date("2026-10-01T11:00:00Z"), 1, now)?.toISOString()).toBe("2026-10-01T10:59:00.000Z");
    expect(computeBotJoinAt(new Date("2026-10-01T11:00:00Z"), 5, now)?.toISOString()).toBe("2026-10-01T10:55:00.000Z");
  });

  it("returns null (join now) when the join time has passed", () => {
    expect(computeBotJoinAt(new Date("2026-10-01T10:00:30Z"), 1, now)).toBeNull();
  });
});
