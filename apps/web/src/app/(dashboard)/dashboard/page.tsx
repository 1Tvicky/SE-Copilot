import Link from "next/link";
import { prisma } from "@meeting-assistant/db";
import { MEETING_TYPE_LABELS, type MeetingTypeValue } from "@meeting-assistant/shared";
import { CalendarPlus, ClipboardCheck, ListTodo, Plug, Radio, Upload } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getUserContext, meetingVisibilityWhere } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { BOT_STATUS, EMAIL_STATUS, MetaBadge, MOM_STATUS, PLATFORM_LABEL } from "@/components/status-badges";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatDate, formatDateTime, formatTime, zonedDayBounds } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true, teamId: true } });
  const timeZone = profile?.timezone ?? "UTC";
  const { start, end } = zonedDayBounds(timeZone);
  const visible = meetingVisibilityWhere(ctx);

  const [today, pendingMoms, readyToSend, recentMeetings, openActions, sourceCount] = await Promise.all([
    prisma.meetingSession.findMany({
      where: { AND: [visible, { scheduledAt: { gte: start, lt: end } }] },
      orderBy: { scheduledAt: "asc" },
      include: {
        customer: { select: { name: true } },
        user: { select: { name: true } },
        mom: { select: { status: true } },
        botSessions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        emailMessages: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        _count: { select: { participants: true, notes: true } },
      },
    }),
    prisma.mom.findMany({
      where: { status: "AWAITING_APPROVAL", meetingSession: visible },
      orderBy: { generatedAt: "asc" },
      take: 5,
      include: { meetingSession: { select: { id: true, name: true, scheduledAt: true, customer: { select: { name: true } } } } },
    }),
    prisma.mom.count({ where: { status: "APPROVED", meetingSession: visible } }),
    prisma.meetingSession.findMany({
      where: { AND: [visible, { status: { in: ["COMPLETED", "FAILED", "PROCESSING"] } }] },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, status: true, updatedAt: true, customer: { select: { name: true } }, mom: { select: { status: true } } },
    }),
    prisma.actionItem.findMany({
      where: { status: { not: "COMPLETED" }, meetingSession: visible },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 5,
      include: { meetingSession: { select: { id: true, name: true } } },
    }),
    profile?.teamId ? prisma.teamMeetingSource.count({ where: { teamId: profile.teamId } }) : Promise.resolve(0),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={15_000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Good to see you, {user.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">
            {new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone }).format(new Date())} · {timeZone}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/meetings/new">
              <CalendarPlus /> Add meeting
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/approvals">
              <ClipboardCheck /> Review approvals
            </Link>
          </Button>
        </div>
      </div>

      {!profile?.teamId && (
        <Card className="border-warning/50">
          <CardContent className="pt-6 text-sm">
            You are not a member of a Solution Engineering team yet, so no team meetings are shown. Ask an admin to add you
            (Admin → Users), or make sure your email domain is listed in the team&apos;s internal domains.
          </CardContent>
        </Card>
      )}
      {profile?.teamId && sourceCount === 0 && (
        <Card className="border-warning/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <span>No team calendar is connected yet, so meetings are not detected automatically.</span>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/team">
                <Plug /> Connect a meeting source
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Today&apos;s meetings</CardTitle>
            <CardDescription>Notetaker, notes, MOM and follow-up status for every meeting today.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {today.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No meetings today.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Meeting</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Assigned SE</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notetaker</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>MOM</TableHead>
                  <TableHead>Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {today.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{formatTime(m.scheduledAt, timeZone)}</TableCell>
                    <TableCell>
                      <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {m.customer?.name ?? "No customer"} · {MEETING_TYPE_LABELS[m.meetingType as MeetingTypeValue]} · {m._count.participants} participants
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{PLATFORM_LABEL[m.platform]}</TableCell>
                    <TableCell className="whitespace-nowrap">{m.user.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell>
                      <MetaBadge map={BOT_STATUS} value={m.botSessions[0]?.status ?? (m.botEligible ? "SCHEDULED" : "NONE")} />
                    </TableCell>
                    <TableCell>{m._count.notes > 0 ? `${m._count.notes}` : "—"}</TableCell>
                    <TableCell>
                      <MetaBadge map={MOM_STATUS} value={m.mom?.status} />
                    </TableCell>
                    <TableCell>
                      <MetaBadge map={EMAIL_STATUS} value={m.emailMessages[0]?.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Pending approvals</CardTitle>
            <CardDescription>
              Nothing reaches a customer until you approve it.
              {readyToSend > 0 && ` ${readyToSend} approved MOM${readyToSend === 1 ? " is" : "s are"} ready to send.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingMoms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No customer MOMs are waiting for review.</p>
            ) : (
              <ul className="divide-y divide-border">
                {pendingMoms.map((mom) => (
                  <li key={mom.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium">{mom.meetingSession.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {mom.meetingSession.customer?.name ?? "No customer"} · {formatDateTime(mom.meetingSession.scheduledAt, timeZone)}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/meetings/${mom.meetingSession.id}?tab=mom`}>Review</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {today.find((m) => !["COMPLETED", "CANCELLED", "FAILED"].includes(m.status)) && (
              <Button asChild variant="outline" className="justify-start">
                <Link href={`/meetings/${today.find((m) => !["COMPLETED", "CANCELLED", "FAILED"].includes(m.status))!.id}/live`}>
                  <Radio /> Open meeting assistant
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" className="justify-start">
              <Link href="/meetings/new">
                <CalendarPlus /> Add a meeting / take notes
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/meetings?status=FAILED">
                <Upload /> Upload a transcript
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/action-items">
                <ListTodo /> Open action items
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent meetings</CardTitle>
          </CardHeader>
          <CardContent>
            {recentMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No processed meetings yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentMeetings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/meetings/${m.id}`} className="block truncate text-sm font-medium hover:underline">
                        {m.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {m.customer?.name ?? "No customer"} · {formatDateTime(m.updatedAt, timeZone)}
                      </p>
                    </div>
                    <MetaBadge map={MOM_STATUS} value={m.mom?.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open action items</CardTitle>
          </CardHeader>
          <CardContent>
            {openActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open action items.</p>
            ) : (
              <ul className="divide-y divide-border">
                {openActions.map((a) => (
                  <li key={a.id} className="py-2.5">
                    <p className="text-sm">{a.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.owner ?? "Owner TBD"}
                      {a.dueDate ? ` · due ${formatDate(a.dueDate)}` : a.dueDateText ? ` · ${a.dueDateText}` : ""} ·{" "}
                      <Link href={`/meetings/${a.meetingSession.id}`} className="hover:underline">
                        {a.meetingSession.name}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
