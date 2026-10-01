"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export function ProviderToggle({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  const router = useRouter();

  async function handleChange(checked: boolean) {
    const res = await fetch(`/api/admin/providers/${providerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: checked }),
    });
    if (!res.ok) {
      toast.error("Could not update provider");
      return;
    }
    router.refresh();
  }

  return <Switch checked={enabled} onCheckedChange={handleChange} />;
}
