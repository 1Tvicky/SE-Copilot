import { z } from "zod";

import { isJoinableMeetingUrl, detectMeetingPlatform } from "./platform-detection.js";
import { MEETING_TYPES } from "./meeting-rules.js";

export const meetingTypeSchema = z.enum(MEETING_TYPES);
export const captureModeSchema = z.enum(["TRANSCRIPT", "MANUAL_NOTES", "TRANSCRIPT_AND_NOTES"]);
export const noteCategorySchema = z.enum([
  "GENERAL",
  "REQUIREMENT",
  "QUESTION",
  "ANSWER",
  "DECISION",
  "ACTION_ITEM",
  "IMPORTANT",
  "FOLLOW_UP",
]);

const participantInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid participant email"),
  name: z.string().trim().max(200).optional(),
});

/**
 * A meeting the SE adds by hand (e.g. calendar not connected yet, or an
 * invite that never reached the team mailbox). The URL is optional: without
 * one the meeting is notes/transcript-only.
 */
export const createMeetingSessionSchema = z
  .object({
    name: z.string().trim().min(3, "Meeting title must be at least 3 characters").max(300),
    meetingUrl: z
      .string()
      .trim()
      .url("Enter a valid meeting URL")
      .refine((url) => {
        const { platform, meetingUrl } = detectMeetingPlatform({ onlineMeetingJoinUrl: url });
        return isJoinableMeetingUrl(platform, meetingUrl);
      }, "URL must be a Zoom (https://*.zoom.us/j/...) or Microsoft Teams (https://teams.microsoft.com/...) join link")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    scheduledAt: z.coerce.date(),
    durationMinutes: z.number().int().min(5).max(480).default(60),
    timezone: z.string().min(1, "Timezone is required"),
    meetingType: meetingTypeSchema.optional(),
    captureMode: captureModeSchema.default("TRANSCRIPT_AND_NOTES"),
    customerName: z.string().trim().max(200).optional(),
    participants: z.array(participantInputSchema).max(100).default([]),
    description: z.string().max(20_000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scheduledAt.getTime() + data.durationMinutes * 60_000 < Date.now() - 7 * 24 * 60 * 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Meetings more than a week in the past can't be added",
        path: ["scheduledAt"],
      });
    }
  });

export type CreateMeetingSessionInput = z.infer<typeof createMeetingSessionSchema>;

export const updateMeetingSchema = z
  .object({
    meetingType: meetingTypeSchema.optional(),
    /** null clears the override (back to the rules). */
    botOverride: z.boolean().nullable().optional(),
    captureMode: captureModeSchema.optional(),
    backupSeUserId: z.string().uuid().nullable().optional(),
    assignedSeUserId: z.string().uuid().optional(),
    customerName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const meetingNoteSchema = z.object({
  category: noteCategorySchema.default("GENERAL"),
  text: z.string().trim().min(1, "Note is empty").max(10_000),
});

export const MAX_TRANSCRIPT_CHARS = 2_000_000;

export const transcriptInputSchema = z.object({
  text: z.string().min(1, "Transcript is empty").max(MAX_TRANSCRIPT_CHARS, "Transcript is too large (2 MB max)"),
  source: z.enum(["upload", "paste"]),
  fileName: z.string().max(255).optional(),
  /** Run the analysis as soon as the transcript is saved. */
  analyze: z.boolean().default(true),
});

export const momUpdateSchema = z.object({
  markdown: z.string().trim().min(1, "MOM is empty").max(100_000),
});

export const momRejectSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason so the next version can address it").max(2_000),
});

const recipientSchema = z.object({
  address: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(200).nullable().optional(),
});

export const emailDraftSchema = z.object({
  to: z.array(recipientSchema).max(50),
  cc: z.array(recipientSchema).max(50).default([]),
  subject: z.string().trim().min(1).max(500),
});

export const emailConfirmSchema = z.object({
  /** The SE ticked "I have reviewed recipients and content". */
  confirm: z.literal(true),
  /** Warnings the SE saw in the final preview; re-validated server-side. */
  acknowledgedWarnings: z.boolean().default(false),
});

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a domain like example.com");

export const teamSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  teamDlAddress: z.string().trim().toLowerCase().email().nullable(),
  teamDlDisplayName: z.string().trim().max(200).nullable(),
  senderMailbox: z.string().trim().toLowerCase().email().nullable(),
  emailSignature: z.string().max(2_000).nullable(),
  internalDomains: z.array(domainSchema).max(50),
  timezone: z.string().min(1),
  botEnabled: z.boolean(),
  botDisplayName: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .refine((n) => /notetaker|copilot|assistant|\bai\b|bot/i.test(n), "The bot name must make clear it is an AI notetaker"),
  botJoinOffsetMinutes: z.union([z.literal(1), z.literal(2), z.literal(5)]),
  botEligibleTypes: z.array(meetingTypeSchema),
  noAiMarkers: z.array(z.string().trim().min(1).max(50)).max(30),
  botJoinMessage: z.string().trim().min(10).max(500),
});

export const meetingSourceSchema = z
  .object({
    type: z.enum(["SHARED_MAILBOX", "GROUP_CALENDAR", "DELEGATED_CALENDAR", "FORWARDED_MAILBOX"]),
    displayName: z.string().trim().min(1).max(200),
    mailboxAddress: z.string().trim().toLowerCase().email().nullable().optional(),
    groupId: z.string().trim().uuid("Group id must be the Microsoft 365 group's object id (a GUID)").nullable().optional(),
    isEnabled: z.boolean().default(true),
    syncDaysAhead: z.number().int().min(1).max(60).default(14),
  })
  .superRefine((v, ctx) => {
    if (v.type === "GROUP_CALENDAR" && !v.groupId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["groupId"], message: "Group calendars need the group id" });
    }
    if (v.type !== "GROUP_CALENDAR" && !v.mailboxAddress) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mailboxAddress"], message: "This source type needs a mailbox address" });
    }
  });

export const SUPPORTED_MEDIA_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export const MAX_MEDIA_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
export const MAX_MEDIA_DURATION_SECONDS = 60 * 60; // 60 minutes

export const mediaUploadMetadataSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(SUPPORTED_MEDIA_MIME_TYPES),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_MEDIA_FILE_SIZE_BYTES, "File exceeds the 500MB limit"),
  durationSeconds: z
    .number()
    .positive()
    .max(MAX_MEDIA_DURATION_SECONDS, "File exceeds the 60 minute limit")
    .optional(),
});

export type MediaUploadMetadataInput = z.infer<typeof mediaUploadMetadataSchema>;

export const notificationPreferencesSchema = z.object({
  meetingScheduled: z.boolean().default(true),
  meetingStarting: z.boolean().default(true),
  joinSucceeded: z.boolean().default(true),
  meetingCompleted: z.boolean().default(true),
  meetingFailed: z.boolean().default(true),
  recordingReady: z.boolean().default(true),
  transcriptReady: z.boolean().default(true),
  summaryReady: z.boolean().default(true),
  botJoined: z.boolean().default(true),
  botFailed: z.boolean().default(true),
  analysisReady: z.boolean().default(true),
  momReady: z.boolean().default(true),
  approvalRequired: z.boolean().default(true),
  emailSent: z.boolean().default(true),
  emailFailed: z.boolean().default(true),
});

export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128)
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a digit"),
  name: z.string().trim().min(1).max(100),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const meetingSessionStatusFilterSchema = z.enum([
  "DRAFT",
  "SCHEDULED",
  "PREPARING",
  "JOINING",
  "WAITING_FOR_ADMISSION",
  "ACTIVE",
  "RECORDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const listMeetingSessionsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: meetingSessionStatusFilterSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.enum(["scheduledAt", "createdAt", "name", "status"]).default("scheduledAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListMeetingSessionsQuery = z.infer<typeof listMeetingSessionsQuerySchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export type SignInInput = z.infer<typeof signInSchema>;
