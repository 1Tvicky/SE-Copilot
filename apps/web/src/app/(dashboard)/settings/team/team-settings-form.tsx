"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MEETING_TYPE_LABELS, MEETING_TYPES, teamSettingsSchema } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Settings {
  name: string;
  teamDlAddress: string | null;
  teamDlDisplayName: string | null;
  senderMailbox: string | null;
  emailSignature: string | null;
  internalDomains: string[];
  timezone: string;
  botEnabled: boolean;
  botDisplayName: string;
  botJoinOffsetMinutes: number;
  botEligibleTypes: string[];
  noAiMarkers: string[];
  botJoinMessage: string;
}

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
const splitList = (v: string) => v.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
const orNull = (v: string) => (v.trim() ? v.trim() : null);

export function TeamSettingsForm({ initial, editable }: { initial: Settings; editable: boolean }) {
  const router = useRouter();
  const [s, setS] = React.useState(initial);
  const [domains, setDomains] = React.useState(initial.internalDomains.join(", "));
  const [markers, setMarkers] = React.useState(initial.noAiMarkers.join(", "));
  const [busy, setBusy] = React.useState(false);
  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...s,
      teamDlAddress: orNull(s.teamDlAddress ?? ""),
      teamDlDisplayName: orNull(s.teamDlDisplayName ?? ""),
      senderMailbox: orNull(s.senderMailbox ?? ""),
      emailSignature: orNull(s.emailSignature ?? ""),
      internalDomains: splitList(domains),
      noAiMarkers: splitList(markers),
    };
    const parsed = teamSettingsSchema.safeParse(payload);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid settings");
    setBusy(true);
    const res = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Not saved");
    toast.success("Team settings saved. Upcoming meetings were re-checked against the new rules.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <fieldset disabled={!editable} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team & customer email</CardTitle>
            <CardDescription>
              Customer MOMs are sent <strong>as the Team DL</strong> through the sending mailbox. When they differ, the mailbox needs Exchange
              &quot;Send As&quot; permission on the DL.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Team name" id="t-name">
              <Input id="t-name" value={s.name} onChange={(e) => update("name", e.target.value)} />
            </Field>
            <Field label="Team timezone" id="t-tz">
              <select id="t-tz" value={s.timezone} onChange={(e) => update("timezone", e.target.value)} className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                {TIMEZONES.map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </select>
            </Field>
            <Field label="Team DL (From address)" id="t-dl">
              <Input id="t-dl" type="email" value={s.teamDlAddress ?? ""} onChange={(e) => update("teamDlAddress", e.target.value)} placeholder="solution-engineering@company.com" />
            </Field>
            <Field label="DL display name" id="t-dln">
              <Input id="t-dln" value={s.teamDlDisplayName ?? ""} onChange={(e) => update("teamDlDisplayName", e.target.value)} placeholder="Solution Engineering Team" />
            </Field>
            <Field label="Sending mailbox" id="t-mb" hint="The licensed or shared mailbox Graph sends through.">
              <Input id="t-mb" type="email" value={s.senderMailbox ?? ""} onChange={(e) => update("senderMailbox", e.target.value)} placeholder="se-copilot@company.com" />
            </Field>
            <Field label="Internal domains" id="t-dom" hint="Attendees from any other domain are treated as customers.">
              <Input id="t-dom" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="company.com, company.io" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email signature" id="t-sig" hint="Added under “Best regards, <DL display name>”.">
                <Textarea id="t-sig" rows={3} value={s.emailSignature ?? ""} onChange={(e) => update("emailSignature", e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI notetaker</CardTitle>
            <CardDescription>The notetaker always joins as a clearly named AI participant and waits for admission like any guest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="t-bot">Auto-join eligible meetings</Label>
              <Switch id="t-bot" checked={s.botEnabled} onCheckedChange={(v: boolean) => update("botEnabled", v)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notetaker name" id="t-bn" hint="Must identify it as AI (e.g. contain “Notetaker” or “AI”).">
                <Input id="t-bn" value={s.botDisplayName} onChange={(e) => update("botDisplayName", e.target.value)} />
              </Field>
              <Field label="Join before start" id="t-off">
                <select
                  id="t-off"
                  value={s.botJoinOffsetMinutes}
                  onChange={(e) => update("botJoinOffsetMinutes", Number(e.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {[1, 2, 5].map((m) => (
                    <option key={m} value={m}>
                      {m} minute{m > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="space-y-2">
              <Label>Join these meeting types</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {MEETING_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s.botEligibleTypes.includes(t)}
                      onChange={(e) =>
                        update("botEligibleTypes", e.target.checked ? [...s.botEligibleTypes, t] : s.botEligibleTypes.filter((x) => x !== t))
                      }
                    />
                    {MEETING_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>
            <Field label='"No AI" markers' id="t-mk" hint="If the invite subject or body contains any of these, the notetaker stays out.">
              <Input id="t-mk" value={markers} onChange={(e) => setMarkers(e.target.value)} />
            </Field>
            <Field label="Message posted in meeting chat when the notetaker joins" id="t-msg">
              <Textarea id="t-msg" rows={3} value={s.botJoinMessage} onChange={(e) => update("botJoinMessage", e.target.value)} />
            </Field>
          </CardContent>
          {editable && (
            <CardFooter className="justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save team settings"}
              </Button>
            </CardFooter>
          )}
        </Card>
      </fieldset>
    </form>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
