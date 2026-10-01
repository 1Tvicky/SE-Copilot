import Link from "next/link";
import { prisma, type Prisma } from "@meeting-assistant/db";
import { requireUser } from "@/lib/session";
import { canManageMeeting, getUserContext, meetingVisibilityWhere } from "@/lib/access";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, localIsoDate } from "@/lib/utils";
import { ActionItemStatusSelect } from "./status-select";

const FILTERS = { open: "Open", overdue: "Overdue", completed: "Completed", all: "All" } as const;
type Filter = keyof typeof FILTERS;

export default async function ActionItemsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const { filter: raw } = await searchParams;
  const filter: Filter = raw && raw in FILTERS ? (raw as Filter) : "open";
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  // Due dates are stored as UTC midnight of the stated calendar day, so compare
  // against UTC midnight of the user's *local* today.
  const todayUtc = new Date(`${localIsoDate(profile?.timezone ?? "UTC")}T00:00:00.000Z`);

  const where: Prisma.ActionItemWhereInput = {
    meetingSession: meetingVisibilityWhere(ctx),
    ...(filter === "open" ? { status: { not: "COMPLETED" } } : {}),
    ...(filter === "completed" ? { status: "COMPLETED" } : {}),
    ...(filter === "overdue" ? { status: { not: "COMPLETED" }, dueDate: { lt: todayUtc } } : {}),
  };
  const items = await prisma.actionItem.findMany({
    where,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    include: {
      customer: { select: { name: true } },
      meetingSession: { select: { id: true, name: true, userId: true, backupSeUserId: true, teamId: true } },
    },
  });

  const dueBadge = (d: Date | null, status: string) => {
    if (!d || status === "COMPLETED") return null;
    if (d < todayUtc) return <Badge variant="destructive">Overdue</Badge>;
    if (d.getTime() === todayUtc.getTime()) return <Badge variant="warning">Due today</Badge>;
    if (d.getTime() - todayUtc.getTime() <= 3 * 24 * 3600_000) return <Badge variant="secondary">Upcoming</Badge>;
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Action items</h1>
        <p className="text-sm text-muted-foreground">Extracted from meetings by the AI, owned and updated by you.</p>
      </div>
      <div className="flex rounded-md border border-border p-0.5 w-fit" role="tablist">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link
            key={f}
            href={`/action-items?filter=${f}`}
            role="tab"
            aria-selected={filter === f}
            className={`rounded px-3 py-1 text-sm ${filter === f ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
          >
            {FILTERS[f]}
          </Link>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No action items.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Customer / meeting</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-md">{a.description}</TableCell>
                    <TableCell>
                      <p className="text-sm">{a.customer?.name ?? "—"}</p>
                      <Link href={`/meetings/${a.meetingSession.id}`} className="text-xs text-muted-foreground hover:underline">
                        {a.meetingSession.name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{a.owner ?? <span className="text-muted-foreground">TBD</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {a.dueDate ? formatDate(a.dueDate) : a.dueDateText ?? "—"}
                        {dueBadge(a.dueDate, a.status)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{a.priority.toLowerCase()}</TableCell>
                    <TableCell>
                      <ActionItemStatusSelect id={a.id} value={a.status} disabled={!canManageMeeting(ctx, a.meetingSession)} />
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
