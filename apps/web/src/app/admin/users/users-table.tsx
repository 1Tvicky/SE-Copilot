"use client";

import * as React from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "MANAGER" | "ADMIN";
  teamId: string | null;
  createdAt: string;
  _count: { meetingSessions: number };
}

export function UsersTable() {
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [teams, setTeams] = React.useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = React.useState("");

  const refresh = React.useCallback((query = "") => {
    fetch(`/api/admin/users?q=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((data: { users: AdminUser[]; teams: { id: string; name: string }[] }) => {
        setUsers(data.users);
        setTeams(data.teams);
      });
  }, []);

  React.useEffect(() => refresh(), [refresh]);

  async function handleTeamChange(id: string, teamId: string | null) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not update team");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, teamId } : u)));
    toast.success("Team updated");
  }

  async function handleRoleChange(id: string, role: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Could not update role");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: role as AdminUser["role"] } : u)));
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Could not delete user");
      return;
    }
    toast.success("User deleted");
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="relative w-72">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refresh(q)}
          onBlur={() => refresh(q)}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Meetings</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Role</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{u._count.meetingSessions}</TableCell>
              <TableCell>{formatDateTime(u.createdAt)}</TableCell>
              <TableCell>
                <select
                  aria-label={`Team for ${u.name}`}
                  value={u.teamId ?? ""}
                  onChange={(e) => handleTeamChange(u.id, e.target.value || null)}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </TableCell>
              <TableCell>
                <Select value={u.role} onValueChange={(v: string) => handleRoleChange(u.id, v)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">SE</SelectItem>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDelete(u.id)}>
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {users.length === 0 && <p className="text-center text-sm text-muted-foreground">No users found.</p>}
      <Badge variant="outline">{users.length} shown</Badge>
    </div>
  );
}
