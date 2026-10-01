# AI analysis (Anthropic Claude)

- Set `ANTHROPIC_API_KEY` on the **worker** (the web app never calls the model).
- `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. Requests use structured output validated against `meetingAnalysisContentSchema`, with `effort: "high"` and server-side refusal fallback (`fallbacks: "default"`).

## Accuracy guarantees built into the pipeline

| Risk | Mitigation |
|---|---|
| Invented requirements, decisions, answers, owners, dates | System prompt forbids it; the schema makes "unknown" representable (`null` owner/answer/date, empty lists, "Not specified in the meeting.") so the model is never forced to fill a field |
| Background context presented as discussed | Previous meetings and the invite description are fenced as background in the prompt |
| Bad JSON / partial output | Structured output plus a second zod validation; `max_tokens` and refusal stop reasons fail the job instead of saving partial content |
| Customer sees internal content | The MOM is rendered deterministically from the analysis and never includes risks, concerns or "interesting topics" |
| Nothing to analyze | No transcript and no notes means the job refuses instead of guessing |
| Silent drift after SE review | Approval pins the MOM's hash; any change after approval requires re-approval |

Every analysis stores which inputs it used (`inputsJson`) and the model name. The UI labels the output AI-generated until an SE edits/approves it.

## Verify

Add a meeting, add a few categorized notes (no transcript needed), then click **Generate MOM**. Within about a minute the Analysis tab fills in and the MOM shows *Awaiting SE approval*. If `ANTHROPIC_API_KEY` is missing, the meeting shows "Analysis failed: AI provider is not configured".
