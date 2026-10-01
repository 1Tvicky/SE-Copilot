import type { NotificationType, PrismaClient } from "@prisma/client";

const SUBJECT: Record<NotificationType, string> = {
  MEETING_SCHEDULED: "Meeting scheduled",
  MEETING_STARTING: "Your meeting is starting",
  JOIN_SUCCEEDED: "Meeting is now active",
  MEETING_COMPLETED: "Meeting completed",
  MEETING_FAILED: "Meeting failed",
  RECORDING_READY: "Recording ready",
  TRANSCRIPT_READY: "Transcript ready",
  SUMMARY_READY: "AI summary ready",
  BOT_JOINED: "SE Copilot Notetaker joined your meeting",
  BOT_FAILED: "Meeting capture unavailable",
  ANALYSIS_READY: "Meeting analysis ready",
  MOM_READY: "Customer MOM is ready for your review",
  APPROVAL_REQUIRED: "Customer communication awaiting your approval",
  EMAIL_SENT: "Customer follow-up sent",
  EMAIL_FAILED: "Customer follow-up failed to send",
};

/** Maps a NotificationType to the matching key in User.notificationPrefs (see the shared Zod schema). */
const PREF_KEY: Record<NotificationType, string> = {
  MEETING_SCHEDULED: "meetingScheduled",
  MEETING_STARTING: "meetingStarting",
  JOIN_SUCCEEDED: "joinSucceeded",
  MEETING_COMPLETED: "meetingCompleted",
  MEETING_FAILED: "meetingFailed",
  RECORDING_READY: "recordingReady",
  TRANSCRIPT_READY: "transcriptReady",
  SUMMARY_READY: "summaryReady",
  BOT_JOINED: "botJoined",
  BOT_FAILED: "botFailed",
  ANALYSIS_READY: "analysisReady",
  MOM_READY: "momReady",
  APPROVAL_REQUIRED: "approvalRequired",
  EMAIL_SENT: "emailSent",
  EMAIL_FAILED: "emailFailed",
};

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type SendEmailFn = (input: { to: string; subject: string; html: string }) => Promise<{ delivered: boolean }>;

/**
 * Shared by both apps/web (e.g. on meeting creation) and apps/worker (e.g.
 * on webhook-driven status changes): creates a Notification row and
 * attempts to email it, respecting both the meeting's notifyOnStatusChange
 * flag and the user's per-type preference. Each app supplies its own
 * sendEmail so this module doesn't need to depend on a specific provider.
 * Never throws into the caller — a notification failure must not fail the
 * underlying request or job.
 */
export async function notifyMeetingEvent(
  prisma: PrismaClient,
  sendEmail: SendEmailFn,
  meetingSessionId: string,
  type: NotificationType,
  body: string,
  appUrl?: string,
): Promise<void> {
  try {
    const meeting = await prisma.meetingSession.findUnique({
      where: { id: meetingSessionId },
      include: { user: { select: { id: true, email: true, notificationPrefs: true } } },
    });
    if (!meeting || !meeting.notifyOnStatusChange) return;

    const prefs = meeting.user.notificationPrefs as Record<string, boolean> | null;
    if (prefs && prefs[PREF_KEY[type]] === false) return;

    // Every notification is visible in-app; email delivery is a best-effort extra.
    const notification = await prisma.notification.create({
      data: { userId: meeting.userId, meetingSessionId, type, channel: "IN_APP", subject: SUBJECT[type], body, status: "PENDING" },
    });

    const link = appUrl ? `<p><a href="${appUrl}/meetings/${meetingSessionId}">Open in SE Copilot</a></p>` : "";
    const result = await sendEmail({ to: meeting.user.email, subject: `[SE Copilot] ${SUBJECT[type]}: ${meeting.name}`, html: `<p>${escape(body)}</p>${link}` });

    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: result.delivered ? "SENT" : "FAILED", sentAt: result.delivered ? new Date() : null },
    });
  } catch (err) {
    // Best-effort: notification delivery must never fail the underlying
    // request or job. Still log it, since a silent failure here would be
    // invisible from the Notification table (the row may never get created).
    console.error("[notify] failed to send notification", { meetingSessionId, type, err });
  }
}
