import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@meeting-assistant/db";
import { isTerminalStatus, MEETING_TYPE_LABELS, meetingAnalysisContentSchema, type MeetingTypeValue } from "@meeting-assistant/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/session";
import { canManageMeeting, findVisibleMeeting, getUserContext } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { BOT_STATUS, MetaBadge, PLATFORM_LABEL } from "@/components/status-badges";
import { AutoRefreshStatus } from "./auto-refresh-status";
import { MeetingTimer } from "./meeting-timer";
import { NotesPanel, type NoteItem } from "@/components/meeting/notes-panel";
import { formatDateTime } from "@/lib/utils";

/**
 * The in-meeting screen: everything the SE needs without navigating — who is
 * there, whether the notetaker is capturing, what was left open last time,
 * and one-keystroke categorized notes.
 */
export default async function LiveMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const { id } = await params;
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  const timeZone = profile?.timezone ?? "UTC";

  const meeting = await findVisibleMeeting(ctx, id, {
    customer: true,
    participants: { orderBy: { role: "asc" } },
    botSessions: { orderBy: { createdAt: "desc" }, take: 1 },
    notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } },
  });
  if (!meeting) notFound();
  const canEdit = canManageMeeting(ctx, meeting);

  const previous = meeting.customerId
    ? await prisma.meetingAnalysis.findFirst({
        where: { status: "READY", meetingSession: { customerId: meeting.customerId, id: { not: meeting.id }, scheduledAt: { lt: meeting.scheduledAt } } },
        orderBy: { createdAt: "desc" },
        include: { meetingSession: { select: { id: true, name: true, scheduledAt: true } } },
      })
    : null;
  const previousContent = previous ? meetingAnalysisContentSchema.safeParse(previous.contentJson) : null;
  const openActions = meeting.customerId
    ? await prisma.actionItem.findMany({ where: { customerId: meeting.customerId, status: { not: "COMPLETED" }, meetingSessionId: { not: meeting.id } }, take: 8 })
    : [];

  const bot = meeting.botSessions[0];
  return (
    <div className="space-y-4">
      <AutoRefreshStatus meetingId={meeting.id} intervalMs={10_000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to meeting">
            <Link href={`/meetings/${meeting.id}`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{meeting.name}</h1>
            <p className="text-sm text-muted-foreground">
              {meeting.customer?.name ?? "No customer"} · {MEETING_TYPE_LABELS[meeting.meetingType as MeetingTypeValue]} · {PLATFORM_LABEL[meeting.platform]}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <MeetingTimer
            startsAt={meeting.scheduledAt.toISOString()}
            startedAt={meeting.startedAt?.toISOString() ?? null}
            endedAt={(meeting.endedAt ?? (isTerminalStatus(meeting.status) ? meeting.endsAt : null))?.toISOString() ?? null}
          />
          <StatusBadge status={meeting.status} />
          <MetaBadge map={BOT_STATUS} value={bot?.status ?? "NONE"} />
          {meeting.meetingUrl && !isTerminalStatus(meeting.status) && (
            <Button asChild size="sm" variant="outline">
              <a href={meeting.meetingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Join
              </a>
            </Button>
          )}
        </div>
      </div>

      {bot?.status === "WAITING_FOR_ADMISSION" && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          SE Copilot Notetaker is waiting in the lobby — admit it from the participants panel to start capture.
        </p>
      )}
      {!bot && (
        <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          {meeting.botIneligibleReason ? `The notetaker is not joining (${meeting.botIneligibleReason}). ` : ""}Your notes below will be used to build the MOM.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live notes</CardTitle>
          </CardHeader>
          <CardContent>
            <NotesPanel
              meetingId={meeting.id}
              canEdit={canEdit && meeting.status !== "CANCELLED"}
              autoFocus
              timeZone={timeZone}
              initialNotes={meeting.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })) as NoteItem[]}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Participants</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {meeting.participants.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="truncate">{p.name ?? p.email}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.isExternal ? "Customer" : "Internal"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {(previousContent?.success || openActions.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">From earlier meetings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {previous && previousContent?.success && (
                  <div className="space-y-1">
                    <Link href={`/meetings/${previous.meetingSession.id}`} className="font-medium hover:underline">
                      {previous.meetingSession.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatDateTime(previous.meetingSession.scheduledAt, timeZone)}</p>
                    {previousContent.data.openQuestions.length > 0 && (
                      <>
                        <p className="pt-1 text-xs font-semibold uppercase text-muted-foreground">Still open</p>
                        <ul className="list-disc space-y-1 pl-4">
                          {previousContent.data.openQuestions.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
                {openActions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Open action items</p>
                    <ul className="list-disc space-y-1 pl-4">
                      {openActions.map((a) => (
                        <li key={a.id}>
                          {a.description}
                          {a.owner ? <span className="text-muted-foreground"> — {a.owner}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
