# API

All routes are under `/api`, are JSON, and require a signed-in session unless noted. Errors are `{ "error": string, "details"?: … }` with a meaningful status: 400 validation, 401 unauthenticated, 403 not allowed, 404 not found / not visible, 409 state conflict, 429 rate-limited, 503 dependency unavailable.

"Manager of the meeting" = assigned SE, backup SE, team manager, or admin.

## Meetings

| Method & path | Who | Description |
|---|---|---|
| `GET /meetings?q&status&from&to&sortBy&sortDir&page&pageSize` | visible | List meetings (search by title or customer) |
| `POST /meetings` | team member | Add a meeting manually. Body: `name`, `meetingUrl?` (Zoom/Teams), `scheduledAt`, `durationMinutes`, `timezone`, `meetingType?`, `captureMode?`, `customerName?`, `participants[{email,name?}]`, `description?` |
| `GET /meetings/:id` | visible | Meeting with participants, bot sessions, notes, latest analysis, MOM, action items, events |
| `PATCH /meetings/:id` | manager | `meetingType`, `botOverride` (true/false/null), `captureMode`, `assignedSeUserId`, `backupSeUserId`, `customerName`. Re-evaluates eligibility and reconciles the bot |
| `DELETE /meetings/:id` | manager (admin if customer email was sent) | Only when cancelled/completed/failed |
| `POST /meetings/:id/cancel` | manager | Cancel; withdraws a scheduled notetaker |
| `GET/POST /meetings/:id/notes` | visible / manager | List / add `{category, text}` |
| `PATCH/DELETE /meetings/:id/notes/:noteId` | manager | Edit / delete a note |
| `POST /meetings/:id/transcript` | manager | `{text, source: "upload"|"paste", fileName?, analyze?}`. Parses VTT/SRT/plain text; queues analysis by default |
| `POST /meetings/:id/analysis` | manager | Generate/regenerate analysis + MOM (refused once the MOM was sent) |

## MOM & customer email

| Method & path | Who | Description |
|---|---|---|
| `GET /meetings/:id/mom` | visible | Current MOM |
| `PATCH /meetings/:id/mom` | manager | `{markdown}`. Revokes any approval; voids unsent drafts |
| `POST /meetings/:id/mom/approve` | manager | Approve; pins the content hash |
| `POST /meetings/:id/mom/reject` | manager | `{reason}` |
| `GET /meetings/:id/email` | visible | Latest email + freshly computed validation |
| `POST /meetings/:id/email` | manager | Prepare the follow-up from the approved MOM (customer participants on To, internal on Cc, From = Team DL) |
| `PATCH /meetings/:id/email` | manager | `{to[], cc[], subject}` on a draft; returns validation |
| `POST /meetings/:id/email/confirm` | manager | `{confirm: true, acknowledgedWarnings}` → 202 queued. Re-validates; warnings need acknowledgement; once only. Rate-limited |

## Other

| Method & path | Who | Description |
|---|---|---|
| `PATCH /action-items/:id` | manager of its meeting | `status`, `priority`, `owner`, `dueDate` |
| `GET/PATCH /team` | member / manager | Team settings (`teamSettingsSchema`); PATCH re-checks upcoming meetings |
| `GET/POST /team/sources` | member / manager | Meeting sources (`meetingSourceSchema`); POST queues a first sync |
| `PATCH/DELETE /team/sources/:id` | manager | Enable/disable, rename, delete |
| `POST /team/sources/:id` | manager | Sync now |
| `GET /admin/users`, `PATCH /admin/users/:id` | admin | Users + teams; set `role` (USER/MANAGER/ADMIN) and `teamId` |
| `POST /admin/jobs/:queue/:jobId/retry` | admin | Retry a failed job (not `email-send`) |
| `/account/*`, `/auth/*` | self / public | Profile, password, sessions; NextAuth (credentials, Microsoft Entra ID, Google) |

## Webhooks (no session; signature required)

| Path | Verification | Events |
|---|---|---|
| `POST /webhooks/recall` | `webhook-*` / `svix-*` HMAC-SHA256, 5-minute tolerance | `bot.*`, `transcript.done`, `transcript.failed` |
| `POST /webhooks/zoom` | `x-zm-signature` HMAC + URL validation | `meeting.started`, `meeting.ended`, `recording.completed` |

Both acknowledge fast and hand off to the worker; 503 tells the sender to retry if the queue is unavailable.
