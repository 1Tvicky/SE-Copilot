import type { MeetingSessionStatus } from "@meeting-assistant/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_META: Record<MeetingSessionStatus, { label: string; variant: BadgeProps["variant"] }> = {
  DRAFT: { label: "Draft", variant: "muted" },
  SCHEDULED: { label: "Scheduled", variant: "outline" },
  PREPARING: { label: "Preparing", variant: "secondary" },
  JOINING: { label: "Joining", variant: "secondary" },
  WAITING_FOR_ADMISSION: { label: "Waiting for admission", variant: "warning" },
  ACTIVE: { label: "Active", variant: "success" },
  RECORDING: { label: "Recording", variant: "success" },
  PROCESSING: { label: "Processing", variant: "secondary" },
  COMPLETED: { label: "Completed", variant: "outline" },
  FAILED: { label: "Failed", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "muted" },
};

export function StatusBadge({ status }: { status: MeetingSessionStatus }) {
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
