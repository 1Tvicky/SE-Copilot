"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GenerateAnalysisButton({ meetingId, hasAnalysis, disabled }: { meetingId: string; hasAnalysis: boolean; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      variant={hasAnalysis ? "outline" : "default"}
      disabled={busy || disabled}
      onClick={async () => {
        if (hasAnalysis && !window.confirm("Regenerate the analysis and MOM? Edits to an unsent MOM are replaced and it will need approval again.")) return;
        setBusy(true);
        const res = await fetch(`/api/meetings/${meetingId}/analysis`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return toast.error(body.error ?? "Could not start the analysis");
        toast.success("Generating the analysis and MOM…");
        router.refresh();
      }}
    >
      <Sparkles /> {hasAnalysis ? "Regenerate" : "Generate MOM"}
    </Button>
  );
}
