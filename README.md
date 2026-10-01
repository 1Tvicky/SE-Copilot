# SE Copilot

An AI assistant for Solution / Presales Engineers. It finds the team's customer meetings, sends a visible AI notetaker into Zoom and Microsoft Teams calls, turns the transcript plus the SE's own notes into meeting intelligence and a customer-ready Minutes of Meeting (MOM), and prepares the follow-up email from the Team DL. **The SE stays in control of every external communication.**

> **AI prepares. The Solution Engineer decides.** Nothing reaches a customer until an SE has reviewed, (optionally) edited, approved the MOM, and explicitly confirmed the send in a final preview. This is enforced server-side, not just in the UI.

This repository is the **MVP** (spec §55). Later phases (knowledge base, daily insights, LinkedIn, …) are listed in [Roadmap](#roadmap).

## What the MVP does

```
Team mailbox / calendar (TeamMeetingSource)
  → meeting detection (every 5 min via Microsoft Graph)
  → Zoom / Teams link + customer + meeting-type detection
  → notetaker eligibility rules (+ SE override)
  → "SE Copilot Notetaker" scheduled to join 1 min early (Recall.ai)
  → capture: bot transcript  + SE live notes (Meeting Assistant)
      └─ capture unavailable? → upload/paste transcript or notes only
  → Claude analysis (summary, requirements, Q&A, decisions, risks, action items, …)
  → customer MOM draft  → SE review / edit / approve / reject / regenerate
  → email preview + validation → SE confirms → sent from the Team DL (Graph)
  → full approval audit trail
```

| Area | Status |
|---|---|
| Meeting sources: shared mailbox, forwarded-invite mailbox, delegated calendar, M365 group calendar | ✅ Microsoft Graph (app-only) |
| Detection of Zoom / Teams links (structured join URL, location, invite body incl. Safe Links) | ✅ |
| Customer detection from attendee domains; meeting classification; SE assignment | ✅ |
| Eligibility rules (types, "No AI" markers, private, platform, URL, provider) + per-meeting override | ✅ |
| AI notetaker for Zoom + Teams, visible name, join-chat announcement, lobby/waiting-room aware | ✅ Recall.ai |
| Reschedule / cancel / meeting-ran-long / bot-not-admitted / captions-off handling | ✅ |
| Live Meeting Assistant: timer, capture status, keyboard-first categorized notes | ✅ |
| Fallback capture: upload `.vtt`/`.srt`/`.txt` or paste transcript; notes-only MOM | ✅ |
| Meeting analysis (structured, schema-validated, "Not specified in the meeting." instead of guesses) | ✅ Claude `claude-opus-5-5` |
| Customer MOM (deterministic render; internal risks never included) with edit/approve/reject/regenerate | ✅ |
| Follow-up email from the Team DL, threaded on the original invite when possible | ✅ Graph `sendMail` / `createReplyAll` |
| Pre-send validation (sender, recipients vs. participants/customer domains, approval hash) | ✅ |
| Approval center, action items, dashboard, integrations status, team settings, notetaker monitoring | ✅ |
| Roles: SE / Manager / Admin; team-scoped visibility; Microsoft Entra ID sign-in | ✅ |

## Architecture

```
apps/web       Next.js 16 (App Router) — UI, REST API, webhook ingress (Recall, Zoom)
apps/worker    Node.js — pg-boss workers: calendar sync, bot scheduling/events, transcripts, analysis, email
packages/db    Prisma schema + client, pg-boss queue client, domain helpers (ingest, eligibility, approvals)
packages/shared Pure TypeScript: detection, classification, eligibility, analysis schema, MOM/email rendering,
               validation, provider interfaces, state machine
```

Postgres is the only infrastructure dependency: the job queue is **pg-boss** (schema `pgboss`), and rate limiting and worker heartbeats are Postgres tables. Details: [docs/architecture.md](docs/architecture.md).

## Quick start (local)

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, INTERNAL_DOMAINS, TEAM_DL ...
npm run db:migrate --workspace=packages/db   # or: npx prisma migrate deploy (non-interactive)
npm run db:seed --workspace=packages/db      # creates the team from TEAM_* env vars
npm run dev:web                               # http://localhost:3000
npm run dev:worker                            # second terminal
```

Sign up with an email in one of `INTERNAL_DOMAINS` to join the team automatically. The very first user of a fresh database becomes ADMIN.

Without external credentials the app still works end to end for manual meetings: add a meeting, take notes, paste a transcript. Set `EMAIL_PROVIDER=dev-outbox` to exercise the send flow locally — emails are recorded and **never delivered** (refused when `NODE_ENV=production`). Generating a MOM needs `ANTHROPIC_API_KEY`.

Full guide: [docs/local-development.md](docs/local-development.md).

## Connecting the real integrations

| Integration | Guide | Env vars |
|---|---|---|
| Microsoft 365: sign-in, team calendar, sending as the DL | [docs/setup/microsoft-365.md](docs/setup/microsoft-365.md) | `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| AI notetaker for Zoom & Teams (Recall.ai) | [docs/setup/notetaker-zoom-teams.md](docs/setup/notetaker-zoom-teams.md) | `RECALL_API_KEY`, `RECALL_API_BASE_URL`, `RECALL_WEBHOOK_SECRET` |
| Claude analysis | [docs/setup/ai.md](docs/setup/ai.md) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Optional Zoom cloud-recording fallback | [docs/setup/notetaker-zoom-teams.md#zoom-cloud-recording-fallback](docs/setup/notetaker-zoom-teams.md#zoom-cloud-recording-fallback) | `ZOOM_*`, `OPENAI_API_KEY` |

The **Integrations** page shows what is connected (it reads only whether settings exist, never their values).

## Documentation

- [Architecture](docs/architecture.md) · [Database schema](docs/database-schema.md) · [API](docs/api.md)
- [Security](docs/security.md) · [Privacy & consent](docs/privacy.md)
- [Local development](docs/local-development.md) · [Production deployment](docs/deployment.md) · [Testing](docs/testing.md)
- Setup: [Microsoft 365](docs/setup/microsoft-365.md) · [Notetaker (Zoom & Teams)](docs/setup/notetaker-zoom-teams.md) · [AI](docs/setup/ai.md)

## Testing

```bash
npm run typecheck && npm run lint && npm run test --workspaces --if-present
RUN_DB_TESTS=1 npm run test --workspace=apps/worker      # pipeline integration tests against Postgres
npm run test:e2e --workspace=apps/web                     # Playwright golden path (app + worker running)
```

See [docs/testing.md](docs/testing.md) for what each layer covers and what is not exercised automatically.

## Known limitations (MVP)

- **The live Claude call, Graph and Recall APIs were not exercised against real accounts while building this** (no credentials in the build environment). Their request shapes follow the vendors' documentation; the code paths around them are covered by integration tests with stubs, and by a manual run in dev-outbox mode. Validate each integration in a test tenant before relying on it — see the setup guides' "verify" sections.
- Calendar changes are picked up by polling (default every 5 minutes), not push notifications.
- Thread replies to the original invitation only work when the invite is in the sending mailbox; otherwise the follow-up is a new message with a `Re:` subject.
- Zoom bots joining meetings hosted by *other* organizations may need Recall's OBF-token setup (Zoom policy since March 2026) — see the notetaker guide.
- Transcript quality depends on the platform's captions when `RECALL_TRANSCRIPT_PROVIDER=meeting_captions` (the default).
- The legacy "media library" screens from the original Meeting Assistant are still in the codebase but no longer linked from the navigation.

## Roadmap

- **Phase 2:** customer history, knowledge base + semantic search (pgvector), meeting preparation page with suggested discovery questions, AI assistant over app data.
- **Phase 3:** organization-wide Daily Insight + weekly digest with privacy scanner and approval, morning scheduler (pg-boss cron is already in place).
- **Phase 4:** LinkedIn drafts with privacy scan and approval-gated publishing.
- **Phase 5:** more meeting platforms (Recall already supports Google Meet/Webex), CRM, Slack, analytics.
