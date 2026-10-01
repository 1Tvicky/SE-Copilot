import { prisma } from "@meeting-assistant/db";
import { requireUser } from "@/lib/session";
import { getUserContext, meetingVisibilityWhere } from "@/lib/access";
import { DashboardNav } from "@/components/nav/dashboard-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  const pendingApprovals = await prisma.mom.count({
    where: { status: { in: ["AWAITING_APPROVAL", "APPROVED"] }, meetingSession: meetingVisibilityWhere(ctx) },
  });

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <DashboardNav isAdmin={user.role === "ADMIN"} pendingApprovals={pendingApprovals} />
      <main className="overflow-x-hidden p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
