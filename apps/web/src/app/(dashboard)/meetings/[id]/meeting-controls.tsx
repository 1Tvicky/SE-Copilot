"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MEETING_TYPE_LABELS, MEETING_TYPES } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

async function patchMeeting(id: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/meetings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast.error(data.error ?? "Update failed");
    return false;
  }
  return true;
}

export function MeetingTypeSelect({ meetingId, value, disabled }: { meetingId: string; value: string; disabled: boolean }) {
  const router = useRouter();
  return (
    <select
      aria-label="Meeting type"
      disabled={disabled}
      defaultValue={value}
      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
      onChange={async (e) => {
        if (await patchMeeting(meetingId, { meetingType: e.target.value })) {
          toast.success("Meeting type updated");
          router.refresh();
        }
      }}
    >
      {MEETING_TYPES.map((t) => (
        <option key={t} value={t}>
          {MEETING_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

/** Three-state notetaker override: follow the eligibility rules, always join, never join. */
export function NotetakerOverride({ meetingId, value, disabled }: { meetingId: string; value: boolean | null; disabled: boolean }) {
  const router = useRouter();
  const current = value === null ? "rules" : value ? "on" : "off";
  return (
    <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Notetaker for this meeting">
      {(
        [
          ["rules", "Follow rules"],
          ["on", "Always join"],
          ["off", "Don't join"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={current === key}
          disabled={disabled}
          className={`rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${current === key ? "bg-accent" : "text-muted-foreground hover:bg-accent/60"}`}
          onClick={async () => {
            if (current === key) return;
            if (await patchMeeting(meetingId, { botOverride: key === "rules" ? null : key === "on" })) {
              toast.success("Notetaker setting updated");
              router.refresh();
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function CancelMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Cancel meeting
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this meeting in SE Copilot?</DialogTitle>
            <DialogDescription>
              Any scheduled notetaker is withdrawn. This does not cancel the calendar invite for attendees.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await fetch(`/api/meetings/${meetingId}/cancel`, { method: "POST" });
                setBusy(false);
                setOpen(false);
                if (res.ok) {
                  toast.success("Meeting cancelled");
                  router.refresh();
                } else {
                  toast.error((await res.json().catch(() => ({}))).error ?? "Could not cancel");
                }
              }}
            >
              Cancel meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
