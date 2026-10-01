"use client";

import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const NOTE_CATEGORIES = [
  { key: "REQUIREMENT", label: "Requirement", shortcut: "1" },
  { key: "QUESTION", label: "Question", shortcut: "2" },
  { key: "ANSWER", label: "Answer", shortcut: "3" },
  { key: "DECISION", label: "Decision", shortcut: "4" },
  { key: "ACTION_ITEM", label: "Action item", shortcut: "5" },
  { key: "IMPORTANT", label: "Important", shortcut: "6" },
  { key: "FOLLOW_UP", label: "Follow-up", shortcut: "7" },
  { key: "GENERAL", label: "Note", shortcut: "0" },
] as const;
type Category = (typeof NOTE_CATEGORIES)[number]["key"];

const CATEGORY_STYLE: Record<Category, string> = {
  REQUIREMENT: "bg-primary/10 text-primary",
  QUESTION: "bg-warning/15 text-warning",
  ANSWER: "bg-success/15 text-success",
  DECISION: "bg-success/15 text-success",
  ACTION_ITEM: "bg-destructive/10 text-destructive",
  IMPORTANT: "bg-destructive/10 text-destructive",
  FOLLOW_UP: "bg-secondary text-secondary-foreground",
  GENERAL: "bg-muted text-muted-foreground",
};

export interface NoteItem {
  id: string;
  category: Category;
  text: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

/**
 * Quick, keyboard-first note taking. Pick a category with Alt+1..7 (Alt+0 =
 * plain note), type, Enter to save (Shift+Enter for a new line). Built to be
 * usable without looking away from the customer.
 */
export function NotesPanel({
  meetingId,
  initialNotes,
  canEdit,
  autoFocus = false,
  timeZone,
}: {
  meetingId: string;
  initialNotes: NoteItem[];
  canEdit: boolean;
  autoFocus?: boolean;
  timeZone?: string;
}) {
  const [notes, setNotes] = React.useState(initialNotes);
  const [category, setCategory] = React.useState<Category>("GENERAL");
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(0);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const listEnd = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const match = NOTE_CATEGORIES.find((c) => c.shortcut === e.key);
      if (match) {
        e.preventDefault();
        setCategory(match.key);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear the box immediately and let saves overlap: during a live meeting the
  // SE keeps typing the next note while the previous one is still in flight,
  // and a slow save must never wipe what they typed since.
  async function save() {
    const value = text.trim();
    if (!value) return;
    const noteCategory = category;
    setText("");
    setCategory("GENERAL");
    inputRef.current?.focus();
    setPending((n) => n + 1);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: noteCategory, text: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Note not saved");
        // Give the text back unless the SE has already started a new note.
        setText((current) => (current.trim() ? current : value));
        setCategory((current) => (current === "GENERAL" ? noteCategory : current));
        return;
      }
      setNotes((prev) => [...prev, body as NoteItem].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      requestAnimationFrame(() => listEnd.current?.scrollIntoView({ block: "end" }));
    } catch {
      toast.error("Note not saved — check your connection");
      setText((current) => (current.trim() ? current : value));
    } finally {
      setPending((n) => n - 1);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/meetings/${meetingId}/notes/${id}`, { method: "DELETE" });
    if (res.ok) setNotes((prev) => prev.filter((n) => n.id !== id));
    else toast.error("Could not delete the note");
  }

  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone }).format(new Date(iso));

  return (
    <div className="space-y-3">
      <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="group flex items-start gap-2 rounded-md border border-border p-2.5">
              <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase", CATEGORY_STYLE[n.category])}>
                {NOTE_CATEGORIES.find((c) => c.key === n.category)?.label}
              </span>
              <p className="flex-1 whitespace-pre-wrap text-sm">{n.text}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{time(n.createdAt)}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                  aria-label="Delete note"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))
        )}
        <div ref={listEnd} />
      </div>

      {canEdit && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Note category">
            {NOTE_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={category === c.key}
                onClick={() => {
                  setCategory(c.key);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  category === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
                )}
                title={`Alt+${c.shortcut}`}
              >
                {c.label}
                <span className="ml-1 opacity-60">Alt+{c.shortcut}</span>
              </button>
            ))}
          </div>
          <Textarea
            ref={inputRef}
            autoFocus={autoFocus}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="Type a note and press Enter (Shift+Enter for a new line)"
            aria-label="New note"
          />
          <div className="flex justify-end gap-2">
            <span className="mr-auto self-center text-xs text-muted-foreground" aria-live="polite">
              {pending > 0 ? "Saving…" : ""}
            </span>
            <Button size="sm" onClick={save} disabled={!text.trim()}>
              Save note
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
