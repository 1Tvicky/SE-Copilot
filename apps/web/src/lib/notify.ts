import { prisma, notifyMeetingEvent, type NotificationType } from "@meeting-assistant/db";
import { sendEmail } from "./email";

/** Thin binder so route handlers don't have to pass prisma/sendEmail/appUrl at every call site. */
export function notify(meetingSessionId: string, type: NotificationType, body: string): Promise<void> {
  return notifyMeetingEvent(prisma, sendEmail, meetingSessionId, type, body, process.env.NEXTAUTH_URL);
}
