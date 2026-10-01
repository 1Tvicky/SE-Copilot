import { describe, expect, it } from "vitest";
import {
  createMeetingSessionSchema,
  meetingSourceSchema,
  mediaUploadMetadataSchema,
  teamSettingsSchema,
  signUpSchema,
} from "./validation.js";

const baseInput = {
  name: "Contoso discovery call",
  meetingUrl: "https://us02web.zoom.us/j/1234567890?pwd=abc",
  scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
  durationMinutes: 60,
  timezone: "America/New_York",
  participants: [{ email: "Jane@Contoso.com", name: "Jane" }],
};

describe("createMeetingSessionSchema", () => {
  it("accepts a valid Zoom meeting and lowercases participant emails", () => {
    const result = createMeetingSessionSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    expect(result.data?.participants[0]?.email).toBe("jane@contoso.com");
  });

  it("accepts a Microsoft Teams join link", () => {
    const result = createMeetingSessionSchema.safeParse({
      ...baseInput,
      meetingUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d",
    });
    expect(result.success).toBe(true);
  });

  it("allows a meeting with no URL (notes/transcript only)", () => {
    const result = createMeetingSessionSchema.safeParse({ ...baseInput, meetingUrl: "" });
    expect(result.success).toBe(true);
    expect(result.data?.meetingUrl).toBeUndefined();
  });

  it("rejects an unsupported platform URL", () => {
    const result = createMeetingSessionSchema.safeParse({
      ...baseInput,
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(result.success).toBe(false);
  });

  it("allows a meeting that already happened today (adding it after the fact)", () => {
    const result = createMeetingSessionSchema.safeParse({
      ...baseInput,
      scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a meeting more than a week in the past", () => {
    const result = createMeetingSessionSchema.safeParse({
      ...baseInput,
      scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a duration outside the allowed bounds", () => {
    expect(createMeetingSessionSchema.safeParse({ ...baseInput, durationMinutes: 1 }).success).toBe(false);
    expect(createMeetingSessionSchema.safeParse({ ...baseInput, durationMinutes: 1000 }).success).toBe(false);
  });
});

describe("teamSettingsSchema", () => {
  const settings = {
    name: "Solution Engineering",
    teamDlAddress: "se-team@cloudfuze.com",
    teamDlDisplayName: "Solution Engineering Team",
    senderMailbox: "se-copilot@cloudfuze.com",
    emailSignature: null,
    internalDomains: ["cloudfuze.com"],
    timezone: "Asia/Kolkata",
    botEnabled: true,
    botDisplayName: "SE Copilot Notetaker",
    botJoinOffsetMinutes: 1,
    botEligibleTypes: ["DEMO"],
    noAiMarkers: ["no ai"],
    botJoinMessage: "SE Copilot Notetaker is an AI assistant transcribing this call.",
  };

  it("accepts a valid configuration", () => {
    expect(teamSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it("rejects a bot name that could pass for a person", () => {
    expect(teamSettingsSchema.safeParse({ ...settings, botDisplayName: "Vignesh T" }).success).toBe(false);
  });

  it("only allows 1, 2 or 5 minute join offsets", () => {
    expect(teamSettingsSchema.safeParse({ ...settings, botJoinOffsetMinutes: 3 }).success).toBe(false);
  });
});

describe("meetingSourceSchema", () => {
  it("requires a mailbox for shared-mailbox sources", () => {
    expect(meetingSourceSchema.safeParse({ type: "SHARED_MAILBOX", displayName: "SE mailbox" }).success).toBe(false);
    expect(
      meetingSourceSchema.safeParse({ type: "SHARED_MAILBOX", displayName: "SE mailbox", mailboxAddress: "se@cloudfuze.com" }).success,
    ).toBe(true);
  });

  it("requires a group id for group calendars", () => {
    expect(meetingSourceSchema.safeParse({ type: "GROUP_CALENDAR", displayName: "SE group" }).success).toBe(false);
  });
});

describe("mediaUploadMetadataSchema", () => {
  it("accepts a valid mp4 under the size and duration limits", () => {
    const result = mediaUploadMetadataSchema.safeParse({
      fileName: "intro.mp4",
      mimeType: "video/mp4",
      fileSizeBytes: 10 * 1024 * 1024,
      durationSeconds: 120,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported mime type", () => {
    const result = mediaUploadMetadataSchema.safeParse({
      fileName: "intro.mov",
      mimeType: "video/quicktime",
      fileSizeBytes: 10 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = mediaUploadMetadataSchema.safeParse({
      fileName: "huge.mp4",
      mimeType: "video/mp4",
      fileSizeBytes: 600 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("rejects a weak password", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "short",
      name: "Test User",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a strong password", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "Str0ngPassw0rd!",
      name: "Test User",
    });
    expect(result.success).toBe(true);
  });
});
