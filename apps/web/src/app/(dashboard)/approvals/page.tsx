import Link from "next/link";
import { prisma } from "@meeting-assistant/db";
import { requireUser } from "@/lib/session";
import { getUserContext, meetingVisibilityWhere } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EMAIL_STATUS, MetaBadge, MOM_STATUS } from "@/components/status-badges";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatDateTime } from "@/lib/utils";

export default async function ApprovalsPage() {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  const timeZone = profile?.timezone ?? "UTC";
  const visible = meetingVisibilityWhere(ctx);

  const [pending, recent] = await Promise.all([
    prisma.mom.findMany({
      where: { status: { in: ["AWAITING_APPROVAL", "APPROVED", "REJECTED"] }, meetingSession: visible },
      orderBy: { generatedAt: "asc" },
      include: {
        meetingSession: {
          select: {
            id: true,
            name: true,
            scheduledAt: true,
            customer: { select: { name: true } },
            user: { select: { name: true } },
            participants: { where: { isExternal: true }, select: { email: true } },
            emailMessages: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, toJson: true } },
          },
        },
      },
    }),
    prisma.emailMessage.findMany({
      where: { status: { in: ["SENT", "FAILED", "QUEUED", "SENDING"] }, meetingSession: visible },
      orderBy: { updatedAt: "desc" },
      take: 15,
      include: { meetingSession: { select: { id: true, name: true, customer: { select: { name: true } } } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={20_000} />
      <div>
        <h1 className="text-2xl font-semibold">Approval center</h1>
        <p className="text-sm text-muted-foreground">
          AI prepares, you decide. Customer communication waits here until you approve the MOM and confirm the send.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer communications</CardTitle>
          <CardDescription>MOMs that are awaiting review, approved but not yet sent, or rejected.</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing is waiting for you. 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer / meeting</TableHead>
                  <TableHead>SE</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>MOM</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((mom) => {
                  const m = mom.meetingSession;
                  const email = m.emailMessages[0];
                  const recipients = email ? (email.toJson as { address: string }[]).map((r) => r.address) : m.participants.map((p) => p.email);
                  return (
                    <TableRow key={mom.id}>
                      <TableCell>
                        <p className="font-medium">{m.customer?.name ?? "No customer"}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.name} · {formatDateTime(m.scheduledAt, timeZone)}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{m.user.name}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={recipients.join(", ")}>
                        {recipients.length ? recipients.join(", ") : "None"}
                      </TableCell>
                      <TableCell>
                        <MetaBadge map={MOM_STATUS} value={mom.status} />
                      </TableCell>
                      <TableCell>
                        <MetaBadge map={EMAIL_STATUS} value={email?.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant={mom.status === "AWAITING_APPROVAL" ? "default" : "outline"}>
                          <Link href={`/meetings/${m.id}?tab=mom`}>
                            {mom.status === "AWAITING_APPROVAL" ? "Review" : mom.status === "APPROVED" ? "Send" : "Fix"}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently sent</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No customer emails sent yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <Link href={`/meetings/${e.meetingSession?.id}?tab=mom`} className="font-medium hover:underline">
                      {e.subject}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {e.meetingSession?.customer?.name ?? ""} · from {e.fromAddress} · {formatDateTime(e.sentAt ?? e.updatedAt, timeZone)}
                      {e.providerMessageId?.startsWith("dev-outbox:") ? " · dev outbox (not delivered)" : ""}
                    </p>
                  </div>
                  <MetaBadge map={EMAIL_STATUS} value={e.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
