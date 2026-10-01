import Link from "next/link";
import { prisma } from "@meeting-assistant/db";
import { describeBotSubCode } from "@meeting-assistant/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { BOT_STATUS, MetaBadge, PLATFORM_LABEL } from "@/components/status-badges";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatDateTime, fromNow } from "@/lib/utils";

/** Bot monitoring: every notetaker session, newest first, with join and capture state. */
export default async function AdminNotetakerPage() {
  const [sessions, counts] = await Promise.all([
    prisma.meetingBotSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { meetingSession: { select: { id: true, name: true, platform: true, status: true, scheduledAt: true } } },
    }),
    prisma.meetingBotSession.groupBy({ by: ["status"], _count: true, where: { createdAt: { gte: fromNow(-30 * 24 * 3600_000) } } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const captured = count("COMPLETED");
  const failed = count("FAILED");

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={15_000} />
      <h1 className="text-2xl font-semibold">Notetaker monitoring</h1>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Captured (30d)", captured],
          ["Capture unavailable (30d)", failed],
          ["Scheduled now", count("SCHEDULED")],
          ["Success rate", captured + failed > 0 ? `${Math.round((captured / (captured + failed)) * 100)}%` : "—"],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bot sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notetaker sessions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meeting</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Scheduled join</TableHead>
                  <TableHead>Join / capture</TableHead>
                  <TableHead>Meeting status</TableHead>
                  <TableHead>Last provider event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/meetings/${s.meetingSession.id}`} className="font-medium hover:underline">
                        {s.meetingSession.name}
                      </Link>
                      <p className="font-mono text-[11px] text-muted-foreground">{s.externalBotId}</p>
                    </TableCell>
                    <TableCell>{PLATFORM_LABEL[s.meetingSession.platform]}</TableCell>
                    <TableCell className="whitespace-nowrap">{s.joinAt ? formatDateTime(s.joinAt) : "Immediately"}</TableCell>
                    <TableCell>
                      <MetaBadge map={BOT_STATUS} value={s.status} />
                      {s.failureReason && <p className="mt-1 max-w-xs text-xs text-destructive">{s.failureReason}</p>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.meetingSession.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.lastStatusCode ?? "—"}
                      {s.lastSubCode ? ` (${describeBotSubCode(s.lastSubCode) ?? s.lastSubCode})` : ""}
                      {s.lastEventAt ? ` · ${formatDateTime(s.lastEventAt)}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
