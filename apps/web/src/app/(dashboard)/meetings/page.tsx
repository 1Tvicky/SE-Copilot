import Link from "next/link";
import { prisma, type Prisma } from "@meeting-assistant/db";
import { MEETING_SESSION_STATUSES, MEETING_TYPE_LABELS, type MeetingSessionStatus, type MeetingTypeValue } from "@meeting-assistant/shared";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getUserContext, meetingVisibilityWhere } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { BOT_STATUS, MetaBadge, MOM_STATUS, PLATFORM_LABEL } from "@/components/status-badges";
import { formatDateTime, fromNow } from "@/lib/utils";

const PAGE_SIZE = 25;
const SCOPES = { upcoming: "Upcoming", past: "Past", all: "All" } as const;
type Scope = keyof typeof SCOPES;

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; scope?: string; page?: string }>;
}) {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const sp = await searchParams;
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  const timeZone = profile?.timezone ?? "UTC";

  const scope: Scope = sp.scope && sp.scope in SCOPES ? (sp.scope as Scope) : sp.status ? "all" : "upcoming";
  const status = MEETING_SESSION_STATUSES.includes(sp.status as MeetingSessionStatus) ? (sp.status as MeetingSessionStatus) : undefined;
  const q = sp.q?.trim().slice(0, 200) || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const now = fromNow(-3 * 3600_000);

  const where: Prisma.MeetingSessionWhereInput = {
    AND: [
      meetingVisibilityWhere(ctx),
      status ? { status } : {},
      scope === "upcoming" ? { scheduledAt: { gte: now } } : scope === "past" ? { scheduledAt: { lt: now } } : {},
      q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] }
        : {},
    ],
  };

  const [total, meetings] = await Promise.all([
    prisma.meetingSession.count({ where }),
    prisma.meetingSession.findMany({
      where,
      orderBy: { scheduledAt: scope === "upcoming" ? "asc" : "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { name: true } },
        user: { select: { name: true } },
        mom: { select: { status: true } },
        botSessions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (params: Record<string, string | undefined>) => {
    const merged = { q, status, scope, ...params };
    const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])));
    return `/meetings?${qs.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Meetings</h1>
          <p className="text-sm text-muted-foreground">Customer meetings detected from the team calendar or added manually.</p>
        </div>
        <Button asChild>
          <Link href="/meetings/new">
            <Plus /> Add meeting
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Time range">
          {(Object.keys(SCOPES) as Scope[]).map((s) => (
            <Link
              key={s}
              href={href({ scope: s, page: undefined })}
              role="tab"
              aria-selected={scope === s}
              className={`rounded px-3 py-1 text-sm ${scope === s ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
            >
              {SCOPES[s]}
            </Link>
          ))}
        </div>
        <form className="flex flex-1 gap-2" action="/meetings">
          <input type="hidden" name="scope" value={scope} />
          <Input name="q" defaultValue={q} placeholder="Search by meeting or customer" className="max-w-sm" aria-label="Search meetings" />
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {MEETING_SESSION_STATUSES.filter((s) => s !== "DRAFT").map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      <Card>
        <CardContent className="pt-6">
          {meetings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No meetings match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Meeting</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>SE</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notetaker</TableHead>
                  <TableHead>MOM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(m.scheduledAt, timeZone)}</TableCell>
                    <TableCell>
                      <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {m.customer?.name ?? "No customer"} · {MEETING_TYPE_LABELS[m.meetingType as MeetingTypeValue]}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{PLATFORM_LABEL[m.platform]}</TableCell>
                    <TableCell className="whitespace-nowrap">{m.user.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell>
                      <MetaBadge map={BOT_STATUS} value={m.botSessions[0]?.status ?? "NONE"} />
                    </TableCell>
                    <TableCell>
                      <MetaBadge map={MOM_STATUS} value={m.mom?.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} · {total} meetings
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: String(page - 1) })}>Previous</Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: String(page + 1) })}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
