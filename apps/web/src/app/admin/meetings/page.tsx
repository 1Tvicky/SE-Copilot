import Link from "next/link";
import { prisma } from "@meeting-assistant/db";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export default async function AdminMeetingsPage() {
  const meetings = await prisma.meetingSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { email: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">All meetings</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {meetings.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">
                  {m.name}
                </Link>
              </TableCell>
              <TableCell>{m.user.email}</TableCell>
              <TableCell>{formatDateTime(m.scheduledAt)}</TableCell>
              <TableCell>
                <StatusBadge status={m.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {meetings.length === 0 && <p className="text-center text-sm text-muted-foreground">No meetings yet.</p>}
    </div>
  );
}
