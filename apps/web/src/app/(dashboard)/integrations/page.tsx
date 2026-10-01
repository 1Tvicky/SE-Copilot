import Link from "next/link";
import { prisma } from "@meeting-assistant/db";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { requireUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

type State = "ok" | "missing" | "warn";

function StatusRow({ label, state, detail }: { label: string; state: State; detail: string }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? CircleDashed : XCircle;
  const color = state === "ok" ? "text-success" : state === "warn" ? "text-warning" : "text-destructive";
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

const set = (v: string | undefined) => Boolean(v && v.trim());

/**
 * Configuration health. Reads only whether settings exist — never their
 * values — so nothing secret reaches the browser.
 */
export default async function IntegrationsPage() {
  const user = await requireUser();
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { teamId: true } });
  const team = profile?.teamId ? await prisma.team.findUnique({ where: { id: profile.teamId }, include: { sources: true } }) : null;
  const lastBot = await prisma.meetingBotSession.findFirst({
    where: { status: "COMPLETED", ...(team ? { meetingSession: { teamId: team.id } } : {}) },
    orderBy: { transcriptReadyAt: "desc" },
    include: { meetingSession: { select: { platform: true, name: true } } },
  });
  const lastSent = await prisma.emailMessage.findFirst({ where: { status: "SENT", teamId: team?.id }, orderBy: { sentAt: "desc" } });

  const graph = set(process.env.MICROSOFT_TENANT_ID) && set(process.env.MICROSOFT_CLIENT_ID) && set(process.env.MICROSOFT_CLIENT_SECRET);
  const devOutbox = process.env.EMAIL_PROVIDER === "dev-outbox";
  const recall = set(process.env.RECALL_API_KEY);
  const recallWebhook = set(process.env.RECALL_WEBHOOK_SECRET);
  const ai = set(process.env.ANTHROPIC_API_KEY) || set(process.env.ANTHROPIC_AUTH_TOKEN);
  const zoomS2S = set(process.env.ZOOM_ACCOUNT_ID) && set(process.env.ZOOM_CLIENT_ID) && set(process.env.ZOOM_CLIENT_SECRET);
  const appUrl = process.env.NEXTAUTH_URL ?? "https://<your-app>";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground">What SE Copilot is connected to. Setup guides are in docs/setup/.</p>
        </div>
        {(user.role === "ADMIN" || user.role === "MANAGER") && (
          <Button asChild variant="outline">
            <Link href="/settings/team">Team settings & meeting sources</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Calendar — Microsoft 365</CardTitle>
            <CardDescription>Detects team meetings from a shared mailbox, group or delegated calendar (TeamMeetingSource).</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow label="Microsoft Graph app credentials" state={graph ? "ok" : "missing"} detail={graph ? "Tenant, client id and secret are set (app-only)." : "Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET."} />
            {(team?.sources ?? []).length === 0 ? (
              <StatusRow label="Meeting sources" state="missing" detail="No team calendar/mailbox connected yet." />
            ) : (
              team!.sources.map((s) => (
                <StatusRow
                  key={s.id}
                  label={`${s.displayName} (${s.type.replace(/_/g, " ").toLowerCase()})`}
                  state={!s.isEnabled ? "warn" : s.lastSyncStatus === "ok" ? "ok" : s.lastSyncStatus === "error" ? "missing" : "warn"}
                  detail={
                    !s.isEnabled
                      ? "Disabled"
                      : s.lastSyncedAt
                        ? `${s.lastSyncStatus === "ok" ? `Synced ${s.lastSyncEventCount ?? 0} events` : `Sync failed: ${s.lastSyncError}`} · ${formatDateTime(s.lastSyncedAt)}`
                        : "Not synced yet"
                  }
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email — Team DL</CardTitle>
            <CardDescription>Customer follow-ups are sent as the Team DL after SE confirmation.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow
              label="Provider"
              state={devOutbox ? "warn" : graph ? "ok" : "missing"}
              detail={devOutbox ? "EMAIL_PROVIDER=dev-outbox: emails are recorded, NOT delivered. Development only." : graph ? "Microsoft Graph sendMail." : "Needs Microsoft Graph credentials (Mail.Send)."}
            />
            <StatusRow label="Sender (Team DL)" state={team?.teamDlAddress ? "ok" : "missing"} detail={team?.teamDlAddress ?? "Not configured in team settings."} />
            <StatusRow
              label="Sending mailbox"
              state={team?.senderMailbox ? "ok" : "missing"}
              detail={team?.senderMailbox ? `${team.senderMailbox}${team.teamDlAddress && team.senderMailbox !== team.teamDlAddress ? " — needs Send As on the DL" : ""}` : "Not configured in team settings."}
            />
            <StatusRow label="Last customer email" state={lastSent ? "ok" : "warn"} detail={lastSent?.sentAt ? formatDateTime(lastSent.sentAt) : "None sent yet."} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI notetaker — Zoom & Microsoft Teams</CardTitle>
            <CardDescription>Recall.ai meeting bots, visibly named “{team?.botDisplayName ?? "SE Copilot Notetaker"}”.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow label="Recall.ai API key" state={recall ? "ok" : "missing"} detail={recall ? `Region: ${process.env.RECALL_API_BASE_URL ?? "https://us-east-1.recall.ai"}` : "Set RECALL_API_KEY. Without it, meetings fall back to notes/uploaded transcripts."} />
            <StatusRow
              label="Status webhook"
              state={recallWebhook ? "ok" : "missing"}
              detail={recallWebhook ? `Endpoint: ${appUrl}/api/webhooks/recall` : `Set RECALL_WEBHOOK_SECRET and point Recall's webhook at ${appUrl}/api/webhooks/recall`}
            />
            <StatusRow label="Auto-join" state={team?.botEnabled ? "ok" : "warn"} detail={team ? `${team.botEnabled ? "On" : "Off"} · joins ${team.botJoinOffsetMinutes} min early` : "No team"} />
            <StatusRow
              label="Last successful capture"
              state={lastBot ? "ok" : "warn"}
              detail={lastBot?.transcriptReadyAt ? `${lastBot.meetingSession.platform === "TEAMS" ? "Teams" : "Zoom"} · ${lastBot.meetingSession.name} · ${formatDateTime(lastBot.transcriptReadyAt)}` : "No meeting captured yet."}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI analysis & Zoom recording fallback</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <StatusRow label="Anthropic Claude" state={ai ? "ok" : "missing"} detail={ai ? `Model: ${process.env.ANTHROPIC_MODEL || "claude-opus-5-5"}` : "Set ANTHROPIC_API_KEY. MOMs can't be generated without it."} />
            <StatusRow
              label="Zoom cloud recordings (optional)"
              state={zoomS2S ? "ok" : "warn"}
              detail={zoomS2S ? "Server-to-Server OAuth set: recordings of meetings hosted in your Zoom account can be transcribed when no notetaker attended." : "Not configured (optional)."}
            />
            <StatusRow
              label="Speech-to-text for Zoom recordings"
              state={set(process.env.OPENAI_API_KEY) ? "ok" : "warn"}
              detail={set(process.env.OPENAI_API_KEY) ? "OpenAI Whisper." : "Only needed for the Zoom cloud-recording fallback."}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
