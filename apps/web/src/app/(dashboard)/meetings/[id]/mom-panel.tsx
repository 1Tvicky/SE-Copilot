"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { markdownToEmailHtml } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetaBadge, MOM_STATUS } from "@/components/status-badges";

export interface MomData {
  id: string;
  status: string;
  markdown: string;
  aiMarkdown: string;
  version: number;
  rejectionReason: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  editedAt: string | null;
}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) toast.error(data.error ?? "Request failed");
  return res.ok;
}

/** Renders our own escaped HTML (markdownToEmailHtml escapes every input character first). */
export function MomPreview({ markdown }: { markdown: string }) {
  return (
    <div
      className="max-w-none rounded-md border border-border bg-card p-4 text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: markdownToEmailHtml(markdown) }}
    />
  );
}

export function MomPanel({ meetingId, mom, canEdit }: { meetingId: string; mom: MomData; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(mom.markdown);
  const [busy, setBusy] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const sent = mom.status === "SENT";

  // The page remounts this panel (via `key`) whenever the stored MOM changes.

  const run = async (fn: () => Promise<boolean>, success: string) => {
    setBusy(true);
    try {
      if (await fn()) {
        toast.success(success);
        router.refresh();
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MetaBadge map={MOM_STATUS} value={mom.status} />
          <span className="text-xs text-muted-foreground">
            Version {mom.version}
            {mom.editedAt ? " · edited by SE" : " · AI-generated"}
            {mom.approvedAt && mom.approvedByName ? ` · approved by ${mom.approvedByName}` : ""}
          </span>
        </div>
        {canEdit && !sent && (
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setRegenOpen(true)} disabled={busy}>
              <RefreshCw /> Regenerate
            </Button>
            {mom.status !== "REJECTED" && (
              <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                <X /> Reject
              </Button>
            )}
            {(mom.status === "AWAITING_APPROVAL" || mom.status === "DRAFT") && !editing && (
              <Button size="sm" onClick={() => run(() => call(`/api/meetings/${meetingId}/mom/approve`, "POST"), "MOM approved")} disabled={busy}>
                <Check /> Approve
              </Button>
            )}
          </div>
        )}
      </div>

      {mom.status === "REJECTED" && mom.rejectionReason && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Rejected: {mom.rejectionReason}. Edit it, or regenerate after adding notes, then approve.
        </p>
      )}
      {mom.status === "APPROVED" && (
        <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          Approved. Prepare the customer email below — editing the MOM now would require approving it again.
        </p>
      )}

      {editing ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Textarea rows={28} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-xs" aria-label="MOM markdown" />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(mom.markdown);
                  setEditing(false);
                }}
              >
                Discard
              </Button>
              <Button
                disabled={busy || draft.trim() === mom.markdown.trim()}
                onClick={async () => {
                  if (await run(() => call(`/api/meetings/${meetingId}/mom`, "PATCH", { markdown: draft }), "MOM saved — awaiting your approval")) {
                    setEditing(false);
                  }
                }}
              >
                Save changes
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <MomPreview markdown={draft} />
          </div>
        </div>
      ) : (
        <MomPreview markdown={mom.markdown} />
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this MOM</DialogTitle>
            <DialogDescription>It won&apos;t be sendable until it is edited or regenerated and approved again.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong with it?" aria-label="Rejection reason" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || busy}
              onClick={async () => {
                if (await run(() => call(`/api/meetings/${meetingId}/mom/reject`, "POST", { reason }), "MOM rejected")) setRejectOpen(false);
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate the analysis and MOM?</DialogTitle>
            <DialogDescription>
              The AI re-reads the transcript and your current notes. Your edits to this MOM are replaced (they stay in the approval
              history), and it will need approval again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await run(() => call(`/api/meetings/${meetingId}/analysis`, "POST"), "Regenerating — this takes a minute")) setRegenOpen(false);
              }}
            >
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
