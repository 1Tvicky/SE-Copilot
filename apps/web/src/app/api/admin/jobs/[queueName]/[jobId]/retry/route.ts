import { NextResponse } from "next/server";
import { getJobQueue, prisma } from "@meeting-assistant/db";
import { ALL_QUEUE_NAMES, type QueueName } from "@meeting-assistant/shared";
import { getApiAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ queueName: string; jobId: string }> },
) {
  const admin = await getApiAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { queueName, jobId } = await params;
  if (!ALL_QUEUE_NAMES.includes(queueName as QueueName)) return NextResponse.json({ error: "Unknown queue" }, { status: 404 });

  const boss = await getJobQueue();
  const [job] = await boss.findJobs(queueName, { id: jobId });
  if (!job) {
    return NextResponse.json({ error: "This job has been archived and can no longer be retried automatically." }, { status: 404 });
  }
  if (job.state !== "failed") {
    return NextResponse.json({ error: `Job is currently "${job.state}", not "failed"` }, { status: 409 });
  }
  if (queueName === "email-send") {
    return NextResponse.json({ error: "Customer emails are never re-sent from here. Re-confirm the send from the meeting page." }, { status: 409 });
  }

  await boss.retry(queueName, jobId);
  await prisma.backgroundJob.updateMany({
    where: { queueName, jobId },
    data: { status: "WAITING", lastError: null },
  });

  await recordAuditEvent({
    actorUserId: admin.id,
    action: "admin.job_retried",
    targetType: "BackgroundJob",
    targetId: `${queueName}:${jobId}`,
  });

  return NextResponse.json({ message: "Job requeued" });
}
