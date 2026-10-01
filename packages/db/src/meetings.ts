import type { MeetingSession, Prisma, PrismaClient, Team } from "@prisma/client";
import {
  classifyMeeting,
  customerNameFromDomain,
  detectCustomerDomains,
  detectMeetingPlatform,
  evaluateBotEligibility,
  isInternalEmail,
  isTerminalStatus,
  type CalendarEventRecord,
  type MeetingTypeValue,
} from "@meeting-assistant/shared";
import { applyMeetingTransition } from "./apply-transition.js";

/** Whether a notetaker provider is configured in this process's environment. */
export function isBotProviderConfigured(): boolean {
  return Boolean(process.env.RECALL_API_KEY);
}

export interface ParticipantInput {
  email: string;
  name: string | null;
  role: "ORGANIZER" | "REQUIRED" | "OPTIONAL" | "RESOURCE";
  responseStatus?: string | null;
}

/**
 * Replaces a meeting's participant list and links it to a customer (matched
 * by email domain, created on first sight). Returns the customer id.
 */
export async function syncParticipantsAndCustomer(
  prisma: PrismaClient,
  team: Pick<Team, "id" | "internalDomains">,
  meetingSessionId: string,
  participants: ParticipantInput[],
  options: { customerNameOverride?: string; keepExistingCustomer?: boolean } = {},
): Promise<string | null> {
  const unique = new Map<string, ParticipantInput>();
  for (const p of participants) {
    const email = p.email.trim().toLowerCase();
    if (!email.includes("@") || p.role === "RESOURCE") continue;
    const existing = unique.get(email);
    // Keep the organizer role if the organizer is also listed as an attendee.
    if (!existing || p.role === "ORGANIZER") unique.set(email, { ...p, email });
  }

  await prisma.$transaction([
    prisma.meetingParticipant.deleteMany({ where: { meetingSessionId, email: { notIn: [...unique.keys()] } } }),
    ...[...unique.values()].map((p) =>
      prisma.meetingParticipant.upsert({
        where: { meetingSessionId_email: { meetingSessionId, email: p.email } },
        update: { name: p.name, role: p.role, responseStatus: p.responseStatus ?? null, isExternal: !isInternalEmail(p.email, team.internalDomains) },
        create: {
          meetingSessionId,
          email: p.email,
          name: p.name,
          role: p.role,
          responseStatus: p.responseStatus ?? null,
          isExternal: !isInternalEmail(p.email, team.internalDomains),
        },
      }),
    ),
  ]);

  const meeting = await prisma.meetingSession.findUnique({ where: { id: meetingSessionId }, select: { customerId: true } });
  if (options.keepExistingCustomer && meeting?.customerId && !options.customerNameOverride) return meeting.customerId;

  const domains = detectCustomerDomains([...unique.keys()], team.internalDomains);
  let customerId: string | null = null;

  if (options.customerNameOverride) {
    const name = options.customerNameOverride.trim();
    const byName = await prisma.customer.findFirst({ where: { teamId: team.id, name: { equals: name, mode: "insensitive" } } });
    const customer =
      byName ??
      (await prisma.customer.create({ data: { teamId: team.id, name, domains } }));
    if (byName && domains.length > 0) {
      const merged = [...new Set([...byName.domains, ...domains])];
      if (merged.length !== byName.domains.length) await prisma.customer.update({ where: { id: byName.id }, data: { domains: merged } });
    }
    customerId = customer.id;
  } else if (domains.length > 0) {
    const match = await prisma.customer.findFirst({ where: { teamId: team.id, domains: { hasSome: domains } } });
    customerId =
      match?.id ??
      (await prisma.customer.create({ data: { teamId: team.id, name: customerNameFromDomain(domains[0]!), domains } })).id;
  }

  await prisma.meetingSession.update({ where: { id: meetingSessionId }, data: { customerId } });
  return customerId;
}

/**
 * Re-evaluates the notetaker eligibility rules for one meeting and stores the
 * result. Returns true when the stored decision changed (caller should
 * reconcile the bot).
 */
export async function refreshBotEligibility(
  prisma: PrismaClient,
  meetingSessionId: string,
  extra: { isPrivate?: boolean; isCancelled?: boolean } = {},
): Promise<{ eligible: boolean; changed: boolean }> {
  const meeting = await prisma.meetingSession.findUnique({ where: { id: meetingSessionId }, include: { team: true } });
  if (!meeting) return { eligible: false, changed: false };
  const team = meeting.team;
  const result = evaluateBotEligibility(
    {
      meetingType: meeting.meetingType as MeetingTypeValue,
      platform: meeting.platform,
      meetingUrl: meeting.meetingUrl,
      subject: meeting.name,
      body: meeting.description,
      isPrivate: extra.isPrivate,
      isCancelled: extra.isCancelled ?? meeting.status === "CANCELLED",
      endsAt: meeting.endsAt,
      override: meeting.botOverride,
    },
    {
      botEnabled: team?.botEnabled ?? false,
      botEligibleTypes: (team?.botEligibleTypes ?? []) as MeetingTypeValue[],
      noAiMarkers: team?.noAiMarkers ?? [],
      botProviderConfigured: isBotProviderConfigured(),
    },
  );
  const changed = result.eligible !== meeting.botEligible || result.reason !== meeting.botIneligibleReason;
  if (changed) {
    await prisma.meetingSession.update({
      where: { id: meetingSessionId },
      data: { botEligible: result.eligible, botIneligibleReason: result.reason },
    });
  }
  return { eligible: result.eligible, changed };
}

export interface IngestResult {
  meetingSessionId: string | null;
  created: boolean;
  /** Something the bot depends on changed (time, URL, eligibility, cancellation). */
  botRelevantChange: boolean;
  skippedReason?: string;
}

/**
 * Picks the assigned SE for a calendar meeting: an internal attendee who is a
 * member of the team (organizer first), else the team's first manager/admin,
 * else any team member.
 */
async function resolveAssignedSe(prisma: PrismaClient, teamId: string, emails: string[]): Promise<string | null> {
  if (emails.length > 0) {
    const members = await prisma.user.findMany({
      where: { teamId, deletedAt: null, email: { in: emails, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    for (const email of emails) {
      const m = members.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (m) return m.id;
    }
  }
  const fallback =
    (await prisma.user.findFirst({ where: { teamId, deletedAt: null, role: { in: ["MANAGER", "ADMIN"] } }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.user.findFirst({ where: { teamId, deletedAt: null }, orderBy: { createdAt: "asc" } }));
  return fallback?.id ?? null;
}

/**
 * Upserts one calendar event from a TeamMeetingSource into a MeetingSession.
 * Idempotent: re-running a sync over the same events changes nothing.
 */
export async function ingestCalendarEvent(
  prisma: PrismaClient,
  team: Team,
  sourceId: string,
  event: CalendarEventRecord,
): Promise<IngestResult> {
  const existing = await prisma.meetingSession.findUnique({
    where: { sourceId_externalEventId: { sourceId, externalEventId: event.externalEventId } },
  });

  if (event.isAllDay) return { meetingSessionId: existing?.id ?? null, created: false, botRelevantChange: false, skippedReason: "all-day event" };

  if (event.isCancelled) {
    if (existing && !isTerminalStatus(existing.status)) {
      await applyMeetingTransition(prisma, {
        meetingSessionId: existing.id,
        toStatus: "CANCELLED",
        source: "SYSTEM",
        message: "Cancelled in the calendar",
        idempotencyKey: `calendar-cancelled:${existing.id}`,
        extraData: { cancelledAt: new Date() },
      });
      await refreshBotEligibility(prisma, existing.id, { isCancelled: true });
      return { meetingSessionId: existing.id, created: false, botRelevantChange: true };
    }
    return { meetingSessionId: existing?.id ?? null, created: false, botRelevantChange: false, skippedReason: "cancelled" };
  }

  if (existing && isTerminalStatus(existing.status) && existing.status !== "FAILED") {
    // Completed/cancelled meetings are history; don't rewrite them from the calendar.
    return { meetingSessionId: existing.id, created: false, botRelevantChange: false, skippedReason: `already ${existing.status}` };
  }

  const detection = detectMeetingPlatform({
    onlineMeetingJoinUrl: event.onlineMeetingJoinUrl,
    onlineMeetingProvider: event.onlineMeetingProvider,
    location: event.location,
    body: event.bodyText,
  });

  const participants: ParticipantInput[] = [
    ...(event.organizer ? [{ email: event.organizer.email, name: event.organizer.name, role: "ORGANIZER" as const }] : []),
    ...event.attendees.map((a) => ({
      email: a.email,
      name: a.name,
      role: a.type === "optional" ? ("OPTIONAL" as const) : a.type === "resource" ? ("RESOURCE" as const) : ("REQUIRED" as const),
      responseStatus: a.responseStatus,
    })),
  ];
  const emails = participants.filter((p) => p.role !== "RESOURCE").map((p) => p.email.toLowerCase());
  const hasExternal = emails.some((e) => !isInternalEmail(e, team.internalDomains));
  const meetingType = existing?.meetingTypeOverridden
    ? existing.meetingType
    : classifyMeeting({ subject: event.subject, body: event.bodyText, hasExternalParticipants: hasExternal });

  const durationMinutes = Math.max(5, Math.round((event.end.getTime() - event.start.getTime()) / 60_000));
  const common = {
    name: event.subject || "(no subject)",
    description: event.bodyText.slice(0, 20_000),
    organizerEmail: event.organizer?.email.toLowerCase() ?? null,
    organizerName: event.organizer?.name ?? null,
    platform: detection.platform,
    meetingUrl: detection.meetingUrl,
    meetingId: detection.zoomMeetingId,
    scheduledAt: event.start,
    endsAt: event.end,
    maxDurationMinutes: Math.min(480, durationMinutes),
    timezone: team.timezone,
    meetingType,
    iCalUId: event.iCalUId,
    calendarLastModifiedAt: event.lastModifiedAt,
    participantDisplayName: team.botDisplayName,
  } satisfies Prisma.MeetingSessionUncheckedUpdateInput;

  let meeting: MeetingSession;
  let created = false;
  let botRelevantChange = false;

  if (existing) {
    botRelevantChange =
      existing.scheduledAt.getTime() !== event.start.getTime() ||
      existing.endsAt?.getTime() !== event.end.getTime() ||
      existing.meetingUrl !== detection.meetingUrl ||
      existing.meetingType !== meetingType;
    meeting = await prisma.meetingSession.update({ where: { id: existing.id }, data: common });
  } else {
    const internalEmails = [event.organizer?.email, ...event.attendees.map((a) => a.email)]
      .filter((e): e is string => Boolean(e) && isInternalEmail(e!, team.internalDomains));
    const assignedSe = await resolveAssignedSe(prisma, team.id, internalEmails);
    if (!assignedSe) {
      return { meetingSessionId: null, created: false, botRelevantChange: false, skippedReason: "team has no members to assign the meeting to" };
    }
    meeting = await prisma.meetingSession.create({
      data: {
        ...common,
        userId: assignedSe,
        teamId: team.id,
        sourceId,
        origin: "CALENDAR",
        externalEventId: event.externalEventId,
        status: "SCHEDULED",
        events: {
          create: { fromStatus: "DRAFT", toStatus: "SCHEDULED", source: "SYSTEM", message: "Detected in the team calendar" },
        },
      },
    });
    created = true;
    botRelevantChange = true;
  }

  await syncParticipantsAndCustomer(prisma, team, meeting.id, participants, { keepExistingCustomer: !created });
  const eligibility = await refreshBotEligibility(prisma, meeting.id, { isPrivate: event.isPrivate });
  return { meetingSessionId: meeting.id, created, botRelevantChange: botRelevantChange || eligibility.changed };
}
