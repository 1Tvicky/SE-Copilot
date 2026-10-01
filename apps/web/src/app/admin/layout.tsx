import { requireAdmin } from "@/lib/session";
import { DashboardNav } from "@/components/nav/dashboard-nav";
import { AdminSubnav } from "./admin-subnav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <DashboardNav isAdmin />
      <main className="overflow-x-hidden p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <AdminSubnav />
          {children}
        </div>
      </main>
    </div>
  );
}
