"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/meetings", label: "Meetings" },
  { href: "/admin/notetaker", label: "Notetaker" },
  { href: "/admin/workers", label: "Workers & queues" },
  { href: "/admin/providers", label: "Providers" },
  { href: "/admin/audit-logs", label: "Audit log" },
];

export function AdminSubnav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-border pb-2">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
