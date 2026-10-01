"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { meetingSourceSchema } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Source {
  id: string;
  type: string;
  displayName: string;
  mailboxAddress: string | null;
  groupId: string | null;
  isEnabled: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncEventCount: number | null;
}

const TYPE_LABELS: Record<string, { label: string; help: string }> = {
  SHARED_MAILBOX: { label: "Shared mailbox", help: "The DL delivers invites to a shared mailbox; its calendar is read." },
  FORWARDED_MAILBOX: { label: "Forwarded-invite mailbox", help: "SEs forward invites to a team mailbox that auto-accepts them." },
  DELEGATED_CALENDAR: { label: "Delegated user calendar", help: "Read a specific person's calendar (e.g. a presales coordinator)." },
  GROUP_CALENDAR: { label: "Microsoft 365 group calendar", help: "A Microsoft 365 group's calendar, by group object id." },
};

export function SourcesManager({ sources, editable }: { sources: Source[]; editable: boolean }) {
  const router = useRouter();
  const [type, setType] = React.useState("SHARED_MAILBOX");
  const [displayName, setDisplayName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function call(url: string, method: string, body?: unknown, success?: string) {
    setBusy(true);
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Request failed");
      return false;
    }
    if (success) toast.success(success);
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      type,
      displayName: displayName || address,
      ...(type === "GROUP_CALENDAR" ? { groupId: address } : { mailboxAddress: address }),
    };
    const parsed = meetingSourceSchema.safeParse(payload);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid source");
    if (await call("/api/team/sources", "POST", payload, "Source added — first sync queued")) {
      setDisplayName("");
      setAddress("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meeting sources</CardTitle>
        <CardDescription>
          Where SE Copilot discovers the team&apos;s customer meetings. A distribution list has no calendar of its own, so point this at the
          mailbox or calendar the DL&apos;s invites land in. Synced every 5 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sources.length === 0 && <p className="text-sm text-muted-foreground">No sources yet.</p>}
        {sources.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {TYPE_LABELS[s.type]?.label} · {s.mailboxAddress ?? s.groupId}
              </p>
              <p className={`text-xs ${s.lastSyncStatus === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                {s.lastSyncedAt
                  ? s.lastSyncStatus === "ok"
                    ? `Last sync ${new Date(s.lastSyncedAt).toLocaleString()} · ${s.lastSyncEventCount ?? 0} events`
                    : `Last sync failed: ${s.lastSyncError}`
                  : "Not synced yet"}
              </p>
            </div>
            {editable && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={s.isEnabled}
                  aria-label={`Enable ${s.displayName}`}
                  onCheckedChange={(v: boolean) => call(`/api/team/sources/${s.id}`, "PATCH", { isEnabled: v })}
                />
                <Button size="sm" variant="outline" disabled={busy || !s.isEnabled} onClick={() => call(`/api/team/sources/${s.id}`, "POST", undefined, "Sync queued")}>
                  <RefreshCw /> Sync now
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${s.displayName}`}
                  disabled={busy}
                  onClick={() => window.confirm(`Remove ${s.displayName}? Meetings already detected are kept.`) && call(`/api/team/sources/${s.id}`, "DELETE", undefined, "Source removed")}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}

        {editable && (
          <form onSubmit={add} className="grid gap-3 rounded-md border border-dashed border-border p-3 sm:grid-cols-[200px_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="src-type">Type</Label>
              <select id="src-type" value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="src-addr">{type === "GROUP_CALENDAR" ? "Group object id" : "Mailbox address"}</Label>
              <Input id="src-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={type === "GROUP_CALENDAR" ? "00000000-0000-…" : "se-meetings@company.com"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="src-name">Display name</Label>
              <Input id="src-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="SE team mailbox" />
            </div>
            <Button type="submit" disabled={busy || !address}>
              Add source
            </Button>
            <p className="text-xs text-muted-foreground sm:col-span-4">{TYPE_LABELS[type]?.help}</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
