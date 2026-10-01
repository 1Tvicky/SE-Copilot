"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

const STATUSES = [
  ["OPEN", "Open"],
  ["IN_PROGRESS", "In progress"],
  ["WAITING", "Waiting"],
  ["COMPLETED", "Completed"],
] as const;

export function ActionItemStatusSelect({ id, value, disabled }: { id: string; value: string; disabled: boolean }) {
  const router = useRouter();
  return (
    <select
      aria-label="Action item status"
      defaultValue={value}
      disabled={disabled}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
      onChange={async (e) => {
        const res = await fetch(`/api/action-items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: e.target.value }),
        });
        if (!res.ok) toast.error((await res.json().catch(() => ({}))).error ?? "Update failed");
        router.refresh();
      }}
    >
      {STATUSES.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
