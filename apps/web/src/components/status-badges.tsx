import { Badge, type BadgeProps } from "@/components/ui/badge";

type Meta = { label: string; variant: BadgeProps["variant"] };

export const BOT_STATUS: Record<string, Meta> = {
  NONE: { label: "No notetaker", variant: "muted" },
  SCHEDULED: { label: "Bot scheduled", variant: "outline" },
  JOINING: { label: "Joining", variant: "secondary" },
  WAITING_FOR_ADMISSION: { label: "Waiting for admission", variant: "warning" },
  JOINED: { label: "Joined", variant: "success" },
  CAPTURING: { label: "Capturing", variant: "success" },
  CALL_ENDED: { label: "Call ended", variant: "secondary" },
  PROCESSING: { label: "Processing", variant: "secondary" },
  COMPLETED: { label: "Captured", variant: "outline" },
  FAILED: { label: "Capture unavailable", variant: "destructive" },
  CANCELLED: { label: "Bot cancelled", variant: "muted" },
};

export const MOM_STATUS: Record<string, Meta> = {
  NONE: { label: "No MOM yet", variant: "muted" },
  DRAFT: { label: "MOM draft", variant: "secondary" },
  AWAITING_APPROVAL: { label: "Awaiting SE approval", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  SENT: { label: "Sent", variant: "outline" },
};

export const EMAIL_STATUS: Record<string, Meta> = {
  NONE: { label: "Not prepared", variant: "muted" },
  DRAFT: { label: "Awaiting send confirmation", variant: "warning" },
  QUEUED: { label: "Queued", variant: "secondary" },
  SENDING: { label: "Sending", variant: "secondary" },
  SENT: { label: "Sent", variant: "success" },
  FAILED: { label: "Send failed", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "muted" },
};

export const PLATFORM_LABEL: Record<string, string> = {
  ZOOM: "Zoom",
  TEAMS: "Microsoft Teams",
  OTHER: "Other platform",
  UNKNOWN: "No meeting link",
};

export function MetaBadge({ map, value }: { map: Record<string, Meta>; value: string | null | undefined }) {
  const meta = map[value ?? "NONE"] ?? { label: value ?? "—", variant: "muted" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
