"use client";

import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  email: string;
  hasPassword: boolean;
  notificationPrefs: Record<string, boolean>;
  createdAt: string;
}

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const NOTIFICATION_LABELS: Record<string, string> = {
  botJoined: "Notetaker joined my meeting",
  botFailed: "Meeting capture unavailable",
  momReady: "MOM ready for my review",
  emailSent: "Customer follow-up sent",
  emailFailed: "Customer follow-up failed",
  meetingFailed: "Meeting processing failed",
};

export default function SettingsPage() {
  const [account, setAccount] = React.useState<Account | null>(null);
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null);
  const [name, setName] = React.useState("");

  const refresh = React.useCallback(() => {
    fetch("/api/account")
      .then((res) => res.json())
      .then((data) => {
        setAccount(data);
        setName(data.name);
      });
    fetch("/api/account/sessions")
      .then((res) => res.json())
      .then(setSessions);
  }, []);

  React.useEffect(refresh, [refresh]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error("Could not update profile");
      return;
    }
    toast.success("Profile updated");
    refresh();
  }

  async function toggleNotification(key: string, value: boolean) {
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationPrefs: { [key]: value } }),
    });
    if (!res.ok) {
      toast.error("Could not update preference");
      return;
    }
    setAccount((prev) => (prev ? { ...prev, notificationPrefs: { ...prev.notificationPrefs, [key]: value } } : prev));
  }

  async function revokeSession(id: string) {
    const res = await fetch(`/api/account/sessions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not revoke session");
      return;
    }
    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
  }

  async function signOutEverywhere() {
    const res = await fetch("/api/account/sessions/revoke-all", { method: "POST" });
    if (!res.ok) {
      toast.error("Could not sign out of all sessions");
      return;
    }
    toast.success("Signed out everywhere");
    await signOut({ callbackUrl: "/sign-in" });
  }

  if (!account) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Account settings</h1>
        <Button asChild variant="outline">
          <Link href="/settings/team">Team settings</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <form onSubmit={saveProfile}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={account.email} disabled />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit">Save profile</Button>
          </CardFooter>
        </form>
      </Card>

      {account.hasPassword && <ChangePasswordCard />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>Choose which events send you an email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(NOTIFICATION_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm">{label}</span>
              <Switch
                checked={account.notificationPrefs[key] ?? true}
                onCheckedChange={(v: boolean) => toggleNotification(key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sessions?.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <div>
                <p className="font-medium">{s.isCurrent ? "This device" : "Session " + s.id.slice(0, 8)}</p>
                <p className="text-xs text-muted-foreground">Last active {formatDateTime(s.lastSeenAt)}</p>
              </div>
              {!s.isCurrent && (
                <Button variant="outline" size="sm" onClick={() => revokeSession(s.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={signOutEverywhere}>
            Log out of all sessions
          </Button>
        </CardFooter>
      </Card>

      <DangerZoneCard hasPassword={account.hasPassword} />
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not change password");
        return;
      }
      toast.success(data.message ?? "Password updated");
      setCurrentPassword("");
      setNewPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change password</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function DangerZoneCard({ hasPassword }: { hasPassword: boolean }) {
  const [confirmText, setConfirmText] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleDelete() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not delete account");
        return;
      }
      await signOut({ callbackUrl: "/" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Delete account</CardTitle>
        <CardDescription>
          Permanently deletes your account and all associated meetings, transcripts,
          notes, MOMs and follow-ups you own. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasPassword && (
          <div className="space-y-2">
            <Label htmlFor="deletePassword">Confirm your password</Label>
            <Input
              id="deletePassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="confirmDelete">Type DELETE to confirm</Label>
          <Input id="confirmDelete" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </div>
      </CardContent>
      <CardFooter>
        <Button
          variant="destructive"
          disabled={confirmText !== "DELETE" || (hasPassword && !password) || submitting}
          onClick={handleDelete}
        >
          {submitting ? "Deleting..." : "Permanently delete my account"}
        </Button>
      </CardFooter>
    </Card>
  );
}
