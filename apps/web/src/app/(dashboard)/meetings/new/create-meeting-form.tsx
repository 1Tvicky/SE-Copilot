"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createMeetingSessionSchema, detectMeetingPlatform, MEETING_TYPE_LABELS, MEETING_TYPES } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function defaultStart(): string {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Jane Doe <jane@contoso.com>, bob@contoso.com" -> [{email, name}] */
function parseParticipants(text: string): { email: string; name?: string }[] {
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const angle = /^(.*)<([^>]+)>$/.exec(entry);
      if (angle) return { email: angle[2]!.trim(), name: angle[1]!.trim().replace(/^"|"$/g, "") || undefined };
      return { email: entry };
    });
}

export function CreateMeetingForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [meetingUrl, setMeetingUrl] = React.useState("");
  const [start, setStart] = React.useState(defaultStart);
  const [duration, setDuration] = React.useState(60);
  const [meetingType, setMeetingType] = React.useState("");
  const [customerName, setCustomerName] = React.useState("");
  const [participants, setParticipants] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const detected = meetingUrl ? detectMeetingPlatform({ onlineMeetingJoinUrl: meetingUrl }).platform : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name,
      meetingUrl,
      scheduledAt: new Date(start),
      durationMinutes: duration,
      timezone: TIMEZONE,
      meetingType: meetingType || undefined,
      customerName: customerName || undefined,
      participants: parseParticipants(participants),
      description: description || undefined,
    };
    const parsed = createMeetingSessionSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not add the meeting");
        return;
      }
      toast.success("Meeting added");
      router.push(`/meetings/${body.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meeting details</CardTitle>
          <CardDescription>
            Meetings in the connected team calendar are added automatically. Use this for anything that wasn&apos;t — including a
            meeting that already happened, so you can turn your notes or a transcript into a MOM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Title</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoso | Slack to Teams discovery" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="url">Zoom or Teams link (optional)</Label>
            <Input id="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://contoso.zoom.us/j/..." />
            <p className="text-xs text-muted-foreground">
              {detected === "ZOOM" || detected === "TEAMS"
                ? `${detected === "ZOOM" ? "Zoom" : "Microsoft Teams"} link — the notetaker can join if the meeting is eligible.`
                : detected
                  ? "That isn't a Zoom or Teams join link; the notetaker can't join it."
                  : "Without a link this meeting is notes/transcript-only."}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="start">Starts ({TIMEZONE})</Label>
              <Input id="start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input id="duration" type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">Meeting type</Label>
              <select
                id="type"
                value={meetingType}
                onChange={(e) => setMeetingType(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Detect automatically</option>
                {MEETING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MEETING_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer">Customer (optional)</Label>
              <Input id="customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Detected from participant domains if blank" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="participants">Participants</Label>
            <Textarea
              id="participants"
              rows={3}
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              placeholder={"Jane Doe <jane@contoso.com>, bob@contoso.com"}
            />
            <p className="text-xs text-muted-foreground">Separate with commas or new lines. You are added as the organizer.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Agenda / description (optional)</Label>
            <Textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Add meeting"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
