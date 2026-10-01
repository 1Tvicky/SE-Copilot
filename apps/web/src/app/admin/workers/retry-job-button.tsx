"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RetryJobButton({ queueName, jobId }: { queueName: string; jobId: string }) {
  const router = useRouter();

  async function handleRetry() {
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(queueName)}/${encodeURIComponent(jobId)}/retry`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Could not retry job");
      return;
    }
    toast.success("Job requeued");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRetry}>
      <RotateCcw className="h-4 w-4" />
      Retry
    </Button>
  );
}
