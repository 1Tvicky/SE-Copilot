import { prisma } from "@meeting-assistant/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export default async function AdminAuditLogsPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { email: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id}>
              <TableCell>{formatDateTime(log.createdAt)}</TableCell>
              <TableCell>{log.actor?.email ?? "system"}</TableCell>
              <TableCell className="font-mono text-xs">{log.action}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {log.targetType ? `${log.targetType}:${log.targetId}` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {logs.length === 0 && <p className="text-center text-sm text-muted-foreground">No audit events yet.</p>}
    </div>
  );
}
