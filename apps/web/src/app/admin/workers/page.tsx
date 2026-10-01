import { getJobQueue, prisma } from "@meeting-assistant/db";
import { ALL_QUEUE_NAMES } from "@meeting-assistant/shared";
import { listActiveWorkers } from "@/lib/worker-health";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatDateTime } from "@/lib/utils";
import { RetryJobButton } from "./retry-job-button";

export default async function AdminWorkersPage() {
  const [workers, queueSummaries, recentFailedJobs] = await Promise.all([
    listActiveWorkers(),
    getJobQueue()
      .then((boss) => boss.getQueues([...ALL_QUEUE_NAMES]))
      .then((queues) =>
        queues.map((q) => ({
          name: q.name,
          counts: { waiting: q.readyCount, active: q.activeCount, delayed: q.deferredCount, completed: q.completedDelta, failed: q.failedCount },
        })),
      )
      .catch(() => []),
    prisma.backgroundJob.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={10_000} />
      <div>
        <h1 className="text-2xl font-semibold">Workers &amp; queues</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active workers</CardTitle>
          <CardDescription>Heartbeats expire 30s after a worker stops checking in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workers are currently reporting in.</p>
          ) : (
            workers.map((w) => (
              <div key={w.workerId} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span className="font-mono text-xs">{w.workerId}</span>
                <span className="text-muted-foreground">pid {w.pid} &middot; started {formatDateTime(w.startedAt)}</span>
                <Badge variant="success">alive</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue status</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Delayed</TableHead>
                <TableHead>Completed (recent)</TableHead>
                <TableHead>Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueSummaries.map((q) => (
                <TableRow key={q.name}>
                  <TableCell className="font-medium">{q.name}</TableCell>
                  <TableCell>{q.counts.waiting}</TableCell>
                  <TableCell>{q.counts.active}</TableCell>
                  <TableCell>{q.counts.delayed}</TableCell>
                  <TableCell>{q.counts.completed}</TableCell>
                  <TableCell className={(q.counts.failed ?? 0) > 0 ? "text-destructive" : undefined}>
                    {q.counts.failed ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently failed jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {recentFailedJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed jobs recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Job type</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead>Failed at</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentFailedJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{job.queueName}</TableCell>
                    <TableCell>{job.jobType}</TableCell>
                    <TableCell>{job.attemptsMade}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">{job.lastError}</TableCell>
                    <TableCell>{job.finishedAt ? formatDateTime(job.finishedAt) : "—"}</TableCell>
                    <TableCell>
                      <RetryJobButton queueName={job.queueName} jobId={job.jobId} />
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
