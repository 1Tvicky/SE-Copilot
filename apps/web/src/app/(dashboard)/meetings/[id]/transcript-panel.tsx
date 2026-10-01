"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { MAX_TRANSCRIPT_CHARS } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface SegmentItem {
  id: string;
  speakerLabel: string | null;
  startMs: number;
  text: string;
}

function offset(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function TranscriptView({ segments, sourceLabel }: { segments: SegmentItem[]; sourceLabel: string }) {
  const [query, setQuery] = React.useState("");
  const shown = query ? segments.filter((s) => `${s.speakerLabel ?? ""} ${s.text}`.toLowerCase().includes(query.toLowerCase())) : segments;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {sourceLabel} · {segments.length} segments
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript"
          aria-label="Search transcript"
          className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-sm"
        />
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-md border border-border p-3">
        {shown.map((s) => (
          <p key={s.id} className="text-sm">
            <span className="mr-2 font-mono text-xs text-muted-foreground">{offset(s.startMs)}</span>
            {s.speakerLabel && <span className="mr-1 font-semibold">{s.speakerLabel}:</span>}
            {s.text}
          </p>
        ))}
        {shown.length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
      </div>
    </div>
  );
}

/** Fallback capture: upload a .vtt/.srt/.txt export or paste text. */
export function TranscriptUpload({ meetingId, hasTranscript }: { meetingId: string; hasTranscript: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    if (file.size > MAX_TRANSCRIPT_CHARS) {
      toast.error("That file is larger than 2 MB.");
      return;
    }
    setText(await file.text());
    setFileName(file.name);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: fileName ? "upload" : "paste", fileName: fileName ?? undefined, analyze: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Transcript not saved");
        return;
      }
      toast.success(`Transcript saved (${body.segments} segments). Generating the analysis and MOM…`);
      setText("");
      setFileName(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {hasTranscript
          ? "Add a better transcript (it replaces the current one for analysis)."
          : "No transcript was captured. Upload the Zoom/Teams transcript file (.vtt, .srt, .txt) or paste the text."}
      </p>
      <div className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".vtt,.srt,.txt,text/vtt,text/plain"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload /> Choose file
        </Button>
        {fileName && <span className="self-center text-sm text-muted-foreground">{fileName}</span>}
      </div>
      <Textarea
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        placeholder={"Paste the transcript here, e.g.\nJane Doe: We need delta migration for 2,000 users.\nVignesh: That's supported..."}
        aria-label="Transcript text"
      />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Save transcript & generate MOM"}
        </Button>
      </div>
    </div>
  );
}
