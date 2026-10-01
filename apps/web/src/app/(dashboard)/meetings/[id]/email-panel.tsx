"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CircleX, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EMAIL_STATUS, MetaBadge } from "@/components/status-badges";

interface Recipient {
  address: string;
  name?: string | null;
}
interface Issue {
  severity: "error" | "warning";
  field: string;
  message: string;
}
export interface EmailData {
  id: string;
  status: string;
  fromAddress: string;
  fromName: string | null;
  senderMailbox: string;
  toJson: Recipient[];
  ccJson: Recipient[];
  subject: string;
  bodyHtml: string;
  sentAt: string | null;
  failureReason: string | null;
  providerMessageId: string | null;
  replyToMessageId: string | null;
}

const toText = (list: Recipient[]) => list.map((r) => (r.name ? `${r.name} <${r.address}>` : r.address)).join(", ");
function parseList(text: string): Recipient[] {
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((e) => {
      const m = /^(.*)<([^>]+)>$/.exec(e);
      return m ? { address: m[2]!.trim(), name: m[1]!.trim() || null } : { address: e, name: null };
    });
}

export function EmailPanel({
  meetingId,
  momApproved,
  canEdit,
  initialEmail,
  initialIssues,
}: {
  meetingId: string;
  momApproved: boolean;
  canEdit: boolean;
  initialEmail: EmailData | null;
  initialIssues: Issue[];
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState(initialEmail);
  const [issues, setIssues] = React.useState(initialIssues);
  const [to, setTo] = React.useState(toText(initialEmail?.toJson ?? []));
  const [cc, setCc] = React.useState(toText(initialEmail?.ccJson ?? []));
  const [subject, setSubject] = React.useState(initialEmail?.subject ?? "");
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(false);

  // No prop syncing: the page remounts this panel (via `key`) whenever the
  // stored email changes, so a background refresh never clobbers edits.
  const adopt = (e: EmailData, newIssues: Issue[]) => {
    setEmail(e);
    setIssues(newIssues);
    setTo(toText(e.toJson));
    setCc(toText(e.ccJson));
    setSubject(e.subject);
  };

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const isDraft = email?.status === "DRAFT";
  const dirty = Boolean(email) && (to !== toText(email!.toJson) || cc !== toText(email!.ccJson) || subject !== email!.subject);

  async function prepare() {
    setBusy(true);
    const res = await fetch(`/api/meetings/${meetingId}/email`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast.error(body.error ?? "Could not prepare the email");
    adopt(body.email, body.validation?.issues ?? []);
    toast.success("Customer email prepared — review it below");
    router.refresh();
  }

  async function saveDraft(): Promise<boolean> {
    setBusy(true);
    const res = await fetch(`/api/meetings/${meetingId}/email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: parseList(to), cc: parseList(cc), subject }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not save");
      return false;
    }
    adopt(body.email, body.validation?.issues ?? []);
    return true;
  }

  async function send() {
    setBusy(true);
    const res = await fetch(`/api/meetings/${meetingId}/email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, acknowledgedWarnings: warnings.length > 0 }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirmOpen(false);
    setReviewed(false);
    if (!res.ok) {
      if (body.details?.issues) setIssues(body.details.issues);
      return toast.error(body.error ?? "Not sent");
    }
    toast.success("Sending the MOM to the customer…");
    router.refresh();
  }

  if (!email) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {momApproved ? "The MOM is approved. Prepare the follow-up email to the customer." : "The customer email can be prepared once the MOM is approved."}
          </p>
        </div>
        {canEdit && momApproved && (
          <Button onClick={prepare} disabled={busy}>
            Prepare customer email
          </Button>
        )}
      </div>
    );
  }

  const devOutbox = email.providerMessageId?.startsWith("dev-outbox:");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetaBadge map={EMAIL_STATUS} value={email.status} />
        {email.status === "SENT" && (
          <span className="text-xs text-muted-foreground">
            {email.sentAt ? new Date(email.sentAt).toLocaleString() : ""}
            {email.replyToMessageId ? " · replied on the original invitation thread" : ""}
          </span>
        )}
        {devOutbox && (
          <span className="rounded bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
            Dev outbox — recorded only, NOT delivered
          </span>
        )}
      </div>
      {email.status === "FAILED" && email.failureReason && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Not sent: {email.failureReason}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-[110px_1fr] sm:items-center">
        <Label>From</Label>
        <p className="text-sm">
          {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}
          {email.fromAddress !== email.senderMailbox && <span className="text-muted-foreground"> · sent via {email.senderMailbox}</span>}
        </p>
        <Label htmlFor="email-to">To</Label>
        <Input id="email-to" value={to} onChange={(e) => setTo(e.target.value)} disabled={!isDraft || !canEdit} />
        <Label htmlFor="email-cc">Cc</Label>
        <Input id="email-cc" value={cc} onChange={(e) => setCc(e.target.value)} disabled={!isDraft || !canEdit} />
        <Label htmlFor="email-subject">Subject</Label>
        <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!isDraft || !canEdit} />
      </div>

      {isDraft && issues.length > 0 && (
        <ul className="space-y-1.5" aria-label="Validation results">
          {errors.map((i) => (
            <li key={i.message} className="flex items-start gap-2 text-sm text-destructive">
              <CircleX className="mt-0.5 h-4 w-4 shrink-0" /> {i.message}
            </li>
          ))}
          {warnings.map((i) => (
            <li key={i.message} className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {i.message}
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Email preview</p>
        <iframe
          title="Customer email preview"
          sandbox=""
          srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff">${email.bodyHtml}</body></html>`}
          className="h-[480px] w-full rounded-md border border-border bg-white"
        />
      </div>

      {isDraft && canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          {dirty && (
            <Button variant="outline" onClick={saveDraft} disabled={busy}>
              Save recipients
            </Button>
          )}
          <Button
            disabled={busy || errors.length > 0}
            onClick={async () => {
              if (dirty && !(await saveDraft())) return;
              setConfirmOpen(true);
            }}
          >
            <Send /> Review & send
          </Button>
        </div>
      )}
      {(email.status === "FAILED" || email.status === "CANCELLED") && canEdit && momApproved && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={prepare} disabled={busy}>
            Prepare again
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this MOM to the customer?</DialogTitle>
            <DialogDescription>This sends a real email from {email.fromAddress}. It can&apos;t be unsent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">To:</span> {toText(email.toJson)}
            </p>
            {email.ccJson.length > 0 && (
              <p>
                <span className="text-muted-foreground">Cc:</span> {toText(email.ccJson)}
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Subject:</span> {email.subject}
            </p>
            {warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2">
                {warnings.map((w) => (
                  <li key={w.message} className="text-warning">
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-start gap-2 pt-2">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-1" />
              <span>
                I have reviewed the recipients and the content{warnings.length > 0 ? ", including the warnings above" : ""}.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} disabled={!reviewed || busy}>
              <Send /> Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
