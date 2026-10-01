import { prisma } from "@meeting-assistant/db";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 MB";
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function AdminOverviewPage() {
  const [userCount, meetingCount, failedMeetings, activeMeetings, mediaUsage, recordingUsage] = await Promise.all([
    prisma.user.count(),
    prisma.meetingSession.count(),
    prisma.meetingSession.count({ where: { status: "FAILED" } }),
    prisma.meetingSession.count({
      where: { status: { in: ["PREPARING", "JOINING", "WAITING_FOR_ADMISSION", "ACTIVE", "RECORDING", "PROCESSING"] } },
    }),
    prisma.mediaAsset.aggregate({ _sum: { fileSizeBytes: true }, where: { deletedAt: null } }),
    prisma.recording.aggregate({ _sum: { fileSizeBytes: true }, where: { deletedAt: null } }),
  ]);

  const stats = [
    { label: "Total users", value: userCount },
    { label: "Total meetings", value: meetingCount },
    { label: "Active now", value: activeMeetings },
    { label: "Failed meetings", value: failedMeetings },
    { label: "Media storage used", value: formatBytes(mediaUsage._sum.fileSizeBytes ?? 0) },
    { label: "Recording storage used", value: formatBytes(recordingUsage._sum.fileSizeBytes ?? 0) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
