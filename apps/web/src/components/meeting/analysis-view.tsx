import type { MeetingAnalysisContent } from "@meeting-assistant/shared";
import { Badge } from "@/components/ui/badge";

function Section({ title, internal, children }: { title: string; internal?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {internal && <Badge variant="muted">Internal only</Badge>}
      </h3>
      {children}
    </section>
  );
}

function List({ items, empty = "None recorded." }: { items: React.ReactNode[]; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Full meeting intelligence, including the internal-only sections the customer MOM leaves out. */
export function AnalysisView({ content }: { content: MeetingAnalysisContent }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6 lg:col-span-2">
        <Section title="Executive summary">
          <p className="text-sm">{content.executiveSummary}</p>
        </Section>
        <Section title="Meeting objective">
          <p className="text-sm">{content.meetingObjective}</p>
        </Section>
      </div>
      <Section title="Customer requirements">
        <List
          items={content.customerRequirements.map((r) => (
            <>
              {r.requirement} <span className="text-xs text-muted-foreground">({r.kind})</span>
            </>
          ))}
        />
      </Section>
      <Section title="Technical discussion">
        <List items={content.technicalDiscussion.map((t) => <><strong>{t.topic}:</strong> {t.details}</>)} />
      </Section>
      <Section title="Questions & answers">
        <List
          items={content.questions.map((q) => (
            <>
              <strong>{q.question}</strong>
              {q.askedBy ? <span className="text-muted-foreground"> — {q.askedBy}</span> : null}
              <br />
              {q.answer ?? <span className="text-warning">Not answered in the meeting</span>}
            </>
          ))}
        />
      </Section>
      <Section title="Decisions">
        <List items={content.decisions.map((d) => (d.context ? `${d.decision} (${d.context})` : d.decision))} />
      </Section>
      <Section title="Action items">
        <List
          items={content.actionItems.map((a) => (
            <>
              {a.description} — <span className="text-muted-foreground">{a.owner ?? "owner TBD"}</span>
              {a.dueDate || a.dueDateText ? <span className="text-muted-foreground"> · due {a.dueDate ?? a.dueDateText}</span> : null}
            </>
          ))}
        />
      </Section>
      <Section title="Open questions">
        <List items={content.openQuestions} />
      </Section>
      <Section title="Next steps">
        <List items={content.nextSteps} />
      </Section>
      <Section title="Customer concerns" internal>
        <List items={content.concerns} />
      </Section>
      <Section title="Risks" internal>
        <List items={content.risks.map((r) => (r.impact ? `${r.risk} — ${r.impact}` : r.risk))} />
      </Section>
      <Section title="Interesting topics" internal>
        <List items={content.interestingTopics.map((t) => <><strong>{t.topic}:</strong> {t.whyInteresting}</>)} />
      </Section>
    </div>
  );
}
