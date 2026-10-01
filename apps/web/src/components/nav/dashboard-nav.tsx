"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { CalendarDays, CheckSquare, LayoutDashboard, ListTodo, LogOut, Plug, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/meetings", label: "Meetings", icon: CalendarDays },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, badgeKey: "approvals" as const },
  { href: "/action-items", label: "Action items", icon: ListTodo },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function DashboardNav({ isAdmin, pendingApprovals = 0 }: { isAdmin: boolean; pendingApprovals?: number }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center gap-2 border-b border-border px-6">
        <Sparkles className="h-5 w-5 text-primary" />
        <Link href="/dashboard" className="font-semibold">
          SE Copilot
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badgeKey === "approvals" && pendingApprovals > 0 && (
                <span
                  className={cn(
                    "rounded-full px-2 text-xs font-semibold",
                    active ? "bg-primary-foreground text-primary" : "bg-warning/20 text-warning",
                  )}
                  aria-label={`${pendingApprovals} pending`}
                >
                  {pendingApprovals}
                </span>
              )}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/admin")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <ShieldCheck className="h-4 w-4" />
            Admin
          </Link>
        )}
      </nav>
      <div className="flex items-center justify-between border-t border-border p-3">
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/" })}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
