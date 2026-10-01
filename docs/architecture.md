# Architecture

## Processes

| Process | What it does | Talks to |
|---|---|---|
| `apps/web` (Next.js) | UI, authenticated REST API, webhook ingress (`/api/webhooks/recall`, `/api/webhooks/zoom`) | Postgres; enqueues pg-boss jobs |
| `apps/worker` | All slow / external work: calendar sync, bot scheduling, webhook processing, transcript download, AI analysis, email sending | Postgres, Microsoft Graph, Recall.ai, Anthropic, (optional) Zoom + OpenAI + S3 |

The two never import each other. They share `packages/shared` (pure logic and contracts) and `packages/db` (Prisma, queue client, domain helpers) and communicate only through the database and the job queue.

## Job queue (pg-boss on Postgres)

One queue per job type (`packages/shared/src/queues.ts`); retry policy per queue lives in one place (`packages/db/src/jobs.ts`).

| Queue | Producer | Purpose | Retries |
|---|---|---|---|
| `calendar-sync` | cron `CALENDAR_SYNC_CRON` (default every 5 min), "Sync now", new source | Pull each TeamMeetingSource's window, ingest events, cancel vanished ones | 1 |
| `bot-schedule` | calendar sync, manual create, PATCH meeting, team settings change, cancel | **Reconcile** the meeting's notetaker with its desired state (create / reschedule / cancel). Idempotent | 4, backoff |
| `bot-events` | `/api/webhooks/recall` | Apply a verified bot status change to the bot session + meeting | 4, backoff |
| `bot-transcript` | `bot.done` / `transcript.done` | Download the transcript into our DB (provider links expire), then queue analysis | 6, backoff |
| `capture-timeout` | bot scheduling | Safety net: meeting end + 60 min with no capture → "capture unavailable". Self-reschedules if the meeting moved | 2 |
| `meeting-analysis` | transcript ready, transcript upload, "Generate/Regenerate" | Claude analysis → action items → MOM draft (awaiting approval) | 2, backoff |
| `email-send` | SE confirmation only | Re-validate, send through the email provider, record | **0** — a duplicate customer email is worse than a visible failure |
| `zoom-webhook-events`, `transcription` | `/api/webhooks/zoom` | Optional Zoom cloud-recording fallback (skipped when a notetaker covered the meeting) | 2 |

Duplicate jobs for the same logical work are collapsed with `singletonKey` (e.g. `bot-<meetingId>`). Handlers are written to be safe to re-run regardless.

## Meeting lifecycle

`MeetingSession.status` is only ever written through `applyMeetingTransition` (`packages/db/src/apply-transition.ts`), which validates against the transition table in `packages/shared/src/state-machine.ts` and records a `MeetingSessionEvent` with an idempotency key (so a retried webhook can't apply twice).

```
SCHEDULED ─► JOINING ─► WAITING_FOR_ADMISSION ─► ACTIVE ─► RECORDING ─► PROCESSING ─► COMPLETED
    │            │               │                                          ▲
    │            └───────────────┴──► FAILED ("Meeting capture unavailable") │
    │                                    └────────── SE uploads transcript / notes ──┘
    └──► CANCELLED (calendar cancel, event deleted, SE cancel)
```

`FAILED` has exactly one exit, back into `PROCESSING`, which is the fallback when capture didn't work: the SE uploads/pastes a transcript or works from notes only. Bot status (`MeetingBotSession.status`) is tracked separately and only moves forward; late or out-of-order webhooks are ignored.

Recall status codes map to bot + meeting statuses in `mapRecallBotStatus` (`packages/shared/src/bot.ts`). For example `call_ended` with `timeout_exceeded_waiting_room` means *never admitted* and becomes a failure with a readable reason.

## From calendar event to meeting

`ingestCalendarEvent` (`packages/db/src/meetings.ts`), for each Graph `calendarView` occurrence:

1. **Platform + join URL** — `detectMeetingPlatform`: Graph's `onlineMeeting.joinUrl`, then location, then the body (HTML-decoded, Outlook Safe Links unwrapped). Zoom (`*.zoom.us/j|s|w|my`, zoomgov), Teams (`meetup-join`, `/meet/`, teams.live.com); Meet/Webex/GoTo are recognized as OTHER.
2. **Participants** — organizer + attendees (rooms/resources dropped), each flagged internal/external against the team's `internalDomains`.
3. **Customer** — external, non-free-mail domains; matched to an existing Customer by domain or created ("contoso.com" → "Contoso", renameable).
4. **Type** — keyword classification (POC, demo, architecture, migration, technical, discovery; external with no match → presales; no external attendee → internal). An SE override is never overwritten by later syncs.
5. **Assigned SE** — first team member among the internal attendees (organizer first), else the team's first manager/admin.
6. **Eligibility** — `evaluateBotEligibility`. Hard blockers (cancelled, over, unsupported platform, no joinable URL, provider not configured) apply even with an override. Soft rules (type list, "No AI" markers, private) are what an SE override bypasses. The *reason* is stored and shown.

Re-syncing the same events is a no-op; a change to time, URL, type or eligibility queues a `bot-schedule` reconcile.

## Notetaker scheduling

`processBotSchedule` computes the desired state (eligible, upcoming, Zoom/Teams with URL) and compares it with the latest not-yet-joined bot. A reschedule is *cancel + create* — a stale bot can never join at the old time. Join time = start − `botJoinOffsetMinutes` (1/2/5), or immediately if that is already past. Bots that already joined are left alone; their own webhooks drive the rest.

Provider abstraction: `MeetingBotProvider` (`packages/shared/src/bot.ts`), implemented by `ZoomMeetingBotProvider` and `MicrosoftTeamsMeetingBotProvider` on top of Recall.ai (`apps/worker/src/integrations/recall`). Adding Google Meet/Webex is a new subclass plus a platform-detection rule.

## Analysis → MOM

`processMeetingAnalysis`:

- Inputs: latest READY transcript (`[m:ss] Speaker: text`), SE notes with categories, calendar context, and the last three analyses of the same customer (background only).
- No transcript **and** no notes → refuses (nothing to work from; no fabrication). AI not configured → fails immediately with a clear reason (no retries).
- Claude (`claude-opus-5-5`, `effort: high`) returns `MeetingAnalysisContent` via structured output; validated again with the same zod schema. Server-side refusal fallback is enabled.
- AI action items replace previous *unedited* AI items; SE-edited items are kept.
- The MOM is rendered **deterministically** from the analysis (`renderMomMarkdown`) — no second model call, and internal sections (risks, concerns, interesting topics) are never included. Empty sections say "Not specified in the meeting."
- A MOM already sent to the customer is never overwritten.

## Approval and sending

```
AI_GENERATED / REGENERATED → (EDITED)* → APPROVED → EMAIL_PREPARED → SEND_CONFIRMED → SENT | SEND_FAILED
                         ↘ REJECTED (must be edited or regenerated, then approved)
```

- Approval stores `sha256(markdown)`. Any later edit revokes the approval and cancels unsent drafts.
- The email body is rendered from the approved MOM at preparation time and carries the same hash.
- `validateStoredEmail` (`packages/db/src/email-checks.ts`) recomputes validation from current data both for the preview and immediately before sending. Errors block; warnings (recipient not in the meeting, outside customer domains, no customer on To) need explicit acknowledgement.
- Confirm is a guarded `DRAFT → QUEUED` update (exactly once); the worker claims `QUEUED → SENDING` atomically.
- Every step writes an `ApprovalEvent` with a content snapshot in the same transaction as the change.

## Provider interfaces

| Interface | File | Implementations |
|---|---|---|
| `CalendarProvider` | `packages/shared/src/integrations.ts` | `GraphCalendarProvider` |
| `EmailProvider` | same | `GraphEmailProvider`, `DevOutboxEmailProvider` (dev only) |
| `MeetingBotProvider` | `packages/shared/src/bot.ts` | Recall-based Zoom / Teams providers |
| `AIProvider` | `apps/worker/src/ai/claude-analysis.ts` | `ClaudeAnalysisProvider` |
| `TranscriptionProvider`, `MeetingProvider` | `packages/shared/src/{ai-providers,provider}.ts` | Whisper, Zoom (cloud-recording fallback) |

## Access control

- Team members see all of their team's meetings (rotation/backup needs it); others see only meetings assigned to them; admins see all.
- Only the assigned SE, the backup SE, team managers and admins can change a meeting, approve or send. Enforced in every API route (`apps/web/src/lib/access.ts`, `lib/api.ts`), not only in the UI. 404 is returned for meetings a user can't see, so existence isn't leaked.
