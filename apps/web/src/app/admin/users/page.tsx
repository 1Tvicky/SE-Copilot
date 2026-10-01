import { UsersTable } from "./users-table";

export default function AdminUsersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <UsersTable />
    </div>
  );
}
