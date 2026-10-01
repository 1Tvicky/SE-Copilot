"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Refreshes the server-rendered status badges without disturbing a note the
 * SE is in the middle of typing: refreshes are skipped while the notes box
 * has focus and text in it.
 */
export function AutoRefreshStatus({ intervalMs }: { meetingId: string; intervalMs: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const id = setInterval(() => {
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement && el.value.trim()) return;
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
