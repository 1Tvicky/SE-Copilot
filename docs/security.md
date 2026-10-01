# Security

SE Copilot holds customer conversations, so these controls are part of the MVP, not later hardening.

## Authentication & sessions

- Microsoft Entra ID sign-in (tenant-pinned), optional Google, and email/password (argon2id; never logged or returned).
- JWT sessions with a server-side `user_sessions` row per sign-in. Users can see and revoke sessions; "log out everywhere" bumps `tokenVersion`. Tokens are re-validated against the database every 5 minutes, so role changes and revocations apply without waiting for expiry.
- Sign-in, sign-up, password-reset and email-send confirmation are rate-limited (Postgres-backed fixed window, shared across instances).
- New users join a team only if their email domain is one of the team's internal domains. Anyone else can sign in but sees nothing.

## Authorization

| Action | Who |
|---|---|
| View a meeting, notes, transcript, MOM | Members of the meeting's team; the assigned/backup SE; admins |
| Change a meeting, add notes/transcripts, approve/reject/regenerate MOM, prepare/confirm email | Assigned SE, backup SE, team managers, admins |
| Team settings, meeting sources | Team managers, admins |
| User roles & team membership, job retries, provider toggles | Admins |

Every API route enforces this (`apps/web/src/lib/access.ts`); page guards are only a convenience. Requests for meetings outside a user's visibility return 404.

## External communication controls

- **No auto-send path exists.** The only producer of `email-send` jobs is `/api/meetings/[id]/email/confirm`, which requires an authenticated manager of the meeting, an `APPROVED` MOM whose content hash still matches the approval, passing validation, acknowledged warnings, and a `DRAFT → QUEUED` transition that can only happen once.
- The worker re-validates before sending and never retries a send automatically. Admins can't retry `email-send` jobs from the jobs panel either.
- The MOM renderer HTML-escapes everything, so SE edits can't inject markup into customer email. The in-app email preview renders in a sandboxed `iframe`.

## Webhooks

- Recall: Svix/standard-webhooks HMAC-SHA256 verification with timing-safe comparison and a 5-minute timestamp tolerance (replay protection).
- Zoom: `x-zm-signature` HMAC verification plus the URL-validation challenge.
- Both return 401 on a bad signature, and 503 when the secret isn't configured (rather than accepting unsigned events).

## Secrets

- All credentials come from environment variables and are read only server-side. The Integrations page shows whether a setting exists, never its value.
- OAuth tokens and meeting passcodes stored in the database are AES-256-GCM encrypted with `ENCRYPTION_KEY`.
- `.env` is git-ignored; `.env.example` contains placeholders only.
- The Graph app's mailbox access must be scoped with RBAC for Applications / an Application Access Policy (see [setup/microsoft-365.md](setup/microsoft-365.md)). Without that, application permissions reach every mailbox in the tenant.
- Rotation: Graph client secrets and the Recall/Anthropic keys can be rotated by updating env vars and restarting. The Graph token cache is in-memory and refreshes automatically. Rotating `ENCRYPTION_KEY` requires re-encrypting stored secrets — don't rotate it casually.

## Encryption

- In transit: run behind HTTPS (the app sets no exceptions). All outbound calls (Graph, Recall, Anthropic, Zoom) are HTTPS.
- At rest: use Postgres with storage encryption (every managed Postgres offers it), plus the column-level encryption above for credentials.

## Audit

- `approval_events`: every AI generation, edit, approval, rejection, preparation, confirmation and send of customer content, with a snapshot of the content at that moment and the acting user. Written in the same transaction as the change.
- `audit_logs`: sign-ins, meeting changes, settings changes, admin actions, with IP where available.
- `meeting_session_events`: every meeting status transition and its source (user, webhook, worker, system).

## Data retention & deletion

- Deleting a meeting (assigned SE/manager, once it is cancelled/completed/failed) cascades to its notes, transcript, analysis, MOM and participants. Meetings with customer email on record can only be deleted by an admin.
- Deleting a user cascades to their meetings.
- Retention schedules (auto-delete transcripts after N days) are not automated in the MVP. Run them as a scheduled SQL job if your policy requires it. pg-boss's own job history is pruned automatically (7 days by default).
