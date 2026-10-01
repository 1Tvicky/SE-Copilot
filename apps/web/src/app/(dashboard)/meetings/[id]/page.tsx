import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, validateStoredEmail } from "@meeting-assistant/db";
import { isTerminalStatus, MEETING_TYPE_LABELS, meetingAnalysisContentSchema, type MeetingTypeValue } from "@meeting-assistant/shared";
import { ExternalLink, Radio } from "lucide-react";
import { requireUser } from "@/lib/session";
import { canManageMeeting, findVisibleMeeting, getUserContext } from "@/lib/access";
import { StatusBadge } from "@/components/status-badge";
import { BOT_STATUS, MetaBadge, PLATFORM_LABEL } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoRefresh } from "@/components/auto-refresh";
import { NotesPanel, type NoteItem } from "@/components/meeting/notes-panel";
import { AnalysisView } from "@/components/meeting/analysis-view";
import { formatDate, formatDateTime, fromNow } from "@/lib/utils";
import { CancelMeetingButton, MeetingTypeSelect, NotetakerOverride } from "./meeting-controls";
import { TranscriptUpload, TranscriptView } from "./transcript-panel";
import { MomPanel } from "./mom-panel";
import { EmailPanel, type EmailData } from "./email-panel";
import { GenerateAnalysisButton } from "./generate-analysis-button";

const TRANSCRIPT_SOURCE_LABEL: Record<string, string> = {
  MEETING_BOT: "Captured by SE Copilot Notetaker",
  RECORDING_TRANSCRIPTION: "Transcribed from the Zoom cloud recording",
  UPLOADED_FILE: "Uploaded by the SE",
  PASTED_TEXT: "Pasted by the SE",
};
const TABS = ["overview", "notes", "transcript", "analysis", "mom", "history"] as const;

export default async function MeetingDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const { id } = await params;
  const { tab } = await searchParams;
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  const timeZone = profile?.timezone ?? "UTC";

  const meeting = await findVisibleMeeting(ctx, id, {
    customer: true,
    team: { select: { botDisplayName: true, botJoinOffsetMinutes: true, teamDlAddress: true } },
    user: { select: { id: true, name: true, email: true } },
    backupSe: { select: { id: true, name: true } },
    participants: { orderBy: [{ role: "asc" }, { email: "asc" }] },
    botSessions: { orderBy: { createdAt: "desc" } },
    notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } },
    transcripts: { where: { status: "READY" }, orderBy: { createdAt: "desc" }, take: 1, include: { segments: { orderBy: { startMs: "asc" }, take: 3000 } } },
    analyses: { orderBy: { createdAt: "desc" }, take: 1 },
    mom: true,
    actionItems: { orderBy: { createdAt: "asc" } },
    events: { orderBy: { occurredAt: "desc" }, take: 50 },
  });
  if (!meeting) notFound();

  const canEdit = canManageMeeting(ctx, meeting);
  const bot = meeting.botSessions[0];
  const transcript = meeting.transcripts[0];
  const analysis = meeting.analyses[0];
  const analysisContent = analysis?.status === "READY" ? meetingAnalysisContentSchema.safeParse(analysis.contentJson) : null;
  const analysisInFlight = analysis?.status === "PROCESSING" || analysis?.status === "PENDING";

  const [email, approvalEvents, approver] = await Promise.all([
    prisma.emailMessage.findFirst({ where: { meetingSessionId: id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } }),
    meeting.mom
      ? prisma.approvalEvent.findMany({
          where: { meetingSessionId: id },
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { actor: { select: { name: true } } },
        })
      : Promise.resolve([]),
    meeting.mom?.approvedById ? prisma.user.findUnique({ where: { id: meeting.mom.approvedById }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const validation = email?.status === "DRAFT" ? await validateStoredEmail(prisma, email.id) : null;

  const activeTab = TABS.includes(tab as (typeof TABS)[number]) ? tab! : meeting.mom && meeting.mom.status !== "SENT" ? "mom" : "overview";
  const live = !isTerminalStatus(meeting.status) && meeting.scheduledAt < fromNow(30 * 60_000);
  const refresh = !isTerminalStatus(meeting.status) || analysisInFlight || email?.status === "QUEUED" || email?.status === "SENDING";

  return (
    <div className="space-y-6">
      {refresh && <AutoRefresh intervalMs={8_000} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{meeting.name}</h1>
            <StatusBadge status={meeting.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {meeting.customer?.name ?? "No customer"} · {formatDateTime(meeting.scheduledAt, timeZone)} · {PLATFORM_LABEL[meeting.platform]} ·{" "}
            {MEETING_TYPE_LABELS[meeting.meetingType as MeetingTypeValue]} · SE: {meeting.user.name}
            {meeting.backupSe ? ` (backup: ${meeting.backupSe.name})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && meeting.status !== "CANCELLED" && meeting.status !== "COMPLETED" && (
            <Button asChild size="sm" variant={live ? "default" : "outline"}>
              <Link href={`/meetings/${meeting.id}/live`}>
                <Radio /> Meeting assistant
              </Link>
            </Button>
          )}
          {meeting.meetingUrl && !isTerminalStatus(meeting.status) && (
            <Button asChild size="sm" variant="outline">
              <a href={meeting.meetingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Join
              </a>
            </Button>
          )}
          {canEdit && !isTerminalStatus(meeting.status) && <CancelMeetingButton meetingId={meeting.id} />}
        </div>
      </div>

      {meeting.status === "FAILED" && meeting.failureReason && (
        <Card className="border-destructive/40">
          <CardContent className="space-y-1 pt-6 text-sm">
            <p className="font-medium text-destructive">{meeting.failureReason}</p>
            <p className="text-muted-foreground">
              Nothing was invented to fill the gap. Upload or paste the transcript, or add your notes, then generate the MOM from what is available.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={activeTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notes">Notes ({meeting.notes.length})</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="mom">MOM & follow-up</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI notetaker</CardTitle>
                <CardDescription>
                  Joins as “{meeting.team?.botDisplayName ?? meeting.participantDisplayName}”, a visibly AI participant, {meeting.team?.botJoinOffsetMinutes ?? 1} min before start.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Status</span>
                  <MetaBadge map={BOT_STATUS} value={bot?.status ?? "NONE"} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Rules</span>
                  <span className={meeting.botEligible ? "text-success" : "text-muted-foreground"}>
                    {meeting.botEligible ? "Will join" : meeting.botIneligibleReason ?? "Won't join"}
                  </span>
                </div>
                {bot?.joinAt && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Join time</span>
                    <span>{formatDateTime(bot.joinAt, timeZone)}</span>
                  </div>
                )}
                {bot?.failureReason && <p className="text-destructive">{bot.failureReason}</p>}
                {canEdit && !isTerminalStatus(meeting.status) && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-muted-foreground">This meeting</span>
                    <NotetakerOverride meetingId={meeting.id} value={meeting.botOverride} disabled={false} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Meeting type</span>
                  <MeetingTypeSelect meetingId={meeting.id} value={meeting.meetingType} disabled={!canEdit || isTerminalStatus(meeting.status)} />
                </div>
                <Row label="Organizer" value={meeting.organizerName ? `${meeting.organizerName} (${meeting.organizerEmail})` : meeting.organizerEmail ?? "—"} />
                <Row label="Ends" value={meeting.endsAt ? formatDateTime(meeting.endsAt, timeZone) : "—"} />
                <Row label="Source" value={meeting.origin === "CALENDAR" ? "Team calendar" : "Added manually"} />
                <Row label="Meeting link" value={meeting.meetingUrl ? meeting.meetingUrl.replace(/\?.*$/, "") : "None"} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Participants ({meeting.participants.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {meeting.participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No participants recorded.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {meeting.participants.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="truncate">
                        {p.name ?? p.email}
                        {p.name && <span className="text-muted-foreground"> · {p.email}</span>}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {p.isExternal ? "Customer" : "Internal"}
                        {p.role === "ORGANIZER" ? " · organizer" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {meeting.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Invite description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">{meeting.description}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="pt-6">
              <NotesPanel
                meetingId={meeting.id}
                canEdit={canEdit && meeting.status !== "CANCELLED"}
                timeZone={timeZone}
                initialNotes={meeting.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })) as NoteItem[]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transcript" className="space-y-4">
          {transcript ? (
            <Card>
              <CardContent className="pt-6">
                <TranscriptView
                  sourceLabel={TRANSCRIPT_SOURCE_LABEL[transcript.source] ?? transcript.source}
                  segments={transcript.segments.map((s) => ({ id: s.id, speakerLabel: s.speakerLabel, startMs: s.startMs, text: s.text }))}
                />
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">
              {bot && !isTerminalStatus(meeting.status) ? "The transcript appears here after the meeting ends." : "No transcript yet."}
            </p>
          )}
          {canEdit && meeting.status !== "CANCELLED" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Upload or paste a transcript</CardTitle>
              </CardHeader>
              <CardContent>
                <TranscriptUpload meetingId={meeting.id} hasTranscript={Boolean(transcript)} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Meeting intelligence</CardTitle>
                <CardDescription>
                  AI-generated from {analysis?.inputsJson ? describeInputs(analysis.inputsJson) : "the transcript and notes"}. Review before relying on it.
                </CardDescription>
              </div>
              {canEdit && meeting.status !== "CANCELLED" && meeting.mom?.status !== "SENT" && (
                <GenerateAnalysisButton meetingId={meeting.id} hasAnalysis={Boolean(analysisContent?.success)} disabled={analysisInFlight} />
              )}
            </CardHeader>
            <CardContent>
              {analysisInFlight ? (
                <p className="text-sm text-muted-foreground">Analyzing the meeting… this usually takes under a minute.</p>
              ) : analysis?.status === "FAILED" ? (
                <p className="text-sm text-destructive">Analysis failed: {analysis.failureReason}</p>
              ) : analysisContent?.success ? (
                <AnalysisView content={analysisContent.data} />
              ) : (
                <p className="text-sm text-muted-foreground">No analysis yet. It runs automatically after the meeting, or generate it from your notes/transcript.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Action items ({meeting.actionItems.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {meeting.actionItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {meeting.actionItems.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{a.description}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {a.owner ?? "Owner TBD"}
                        {a.dueDate ? ` · ${formatDate(a.dueDate)}` : a.dueDateText ? ` · ${a.dueDateText}` : ""} · {a.status.replace("_", " ").toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mom" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Minutes of meeting</CardTitle>
              <CardDescription>Customer-facing. Nothing is sent until you approve it and confirm the email.</CardDescription>
            </CardHeader>
            <CardContent>
              {meeting.mom ? (
                <MomPanel
                  key={`${meeting.mom.id}:${meeting.mom.version}:${meeting.mom.updatedAt.toISOString()}`}
                  meetingId={meeting.id}
                  canEdit={canEdit}
                  mom={{
                    id: meeting.mom.id,
                    status: meeting.mom.status,
                    markdown: meeting.mom.markdown,
                    aiMarkdown: meeting.mom.aiMarkdown,
                    version: meeting.mom.version,
                    rejectionReason: meeting.mom.rejectionReason,
                    approvedAt: meeting.mom.approvedAt?.toISOString() ?? null,
                    approvedByName: approver?.name ?? null,
                    editedAt: meeting.mom.editedAt?.toISOString() ?? null,
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {analysisInFlight ? "The MOM is being generated…" : "No MOM yet. It is generated with the meeting analysis."}
                  </p>
                  {canEdit && meeting.status !== "CANCELLED" && !analysisInFlight && (
                    <GenerateAnalysisButton meetingId={meeting.id} hasAnalysis={false} disabled={false} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {meeting.mom && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Customer follow-up email</CardTitle>
                <CardDescription>
                  Sent from the Team DL{meeting.team?.teamDlAddress ? ` (${meeting.team.teamDlAddress})` : ""} after your explicit confirmation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmailPanel
                  key={email ? `${email.id}:${email.status}:${email.updatedAt.toISOString()}` : "none"}
                  meetingId={meeting.id}
                  canEdit={canEdit}
                  momApproved={meeting.mom.status === "APPROVED"}
                  initialEmail={email ? (JSON.parse(JSON.stringify(email)) as EmailData) : null}
                  initialIssues={validation?.issues ?? []}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approval trail</CardTitle>
              <CardDescription>Every AI generation, SE edit, approval and send of customer communication.</CardDescription>
            </CardHeader>
            <CardContent>
              {approvalEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {approvalEvents.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs text-muted-foreground">{formatDateTime(e.createdAt, timeZone)}</span>
                      <span className="font-medium">{e.action.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="text-muted-foreground">
                        {e.contentType === "MOM" ? "MOM" : "email"} · {e.actor?.name ?? "SE Copilot"}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Meeting timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {meeting.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground">{formatDateTime(e.occurredAt, timeZone)}</span>
                    <span className="font-medium">
                      {e.fromStatus.toLowerCase()} → {e.toStatus.toLowerCase()}
                    </span>
                    {e.message && <span className="text-muted-foreground">{e.message}</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

function describeInputs(inputs: unknown): string {
  const i = inputs as { transcriptSegments?: number; notes?: number };
  const parts = [];
  if (i.transcriptSegments) parts.push(`a ${i.transcriptSegments}-segment transcript`);
  if (i.notes) parts.push(`${i.notes} SE note${i.notes === 1 ? "" : "s"}`);
  return parts.join(" and ") || "the available inputs";
}
