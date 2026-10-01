# Local development

## Prerequisites

- Node.js 20+ (developed on 24).
- PostgreSQL 13+ — a local install or `docker compose up postgres -d`. This is the only required service: the job queue (pg-boss), rate limiting and worker heartbeats all live in Postgres.
- Optional: MinIO (`docker compose up minio minio-init -d`), only for the Zoom cloud-recording fallback.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in at least:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/se_copilot
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
INTERNAL_DOMAINS=example.com          # your company domain(s)
TEAM_DL=se-team@example.com
EMAIL_SENDER_MAILBOX=se-copilot@example.com
EMAIL_PROVIDER=dev-outbox             # record emails instead of sending
```

```bash
cd packages/db
npx prisma migrate deploy             # applies migrations (non-interactive)
npx tsx prisma/seed.ts                # creates the team from TEAM_* vars (reads ../../.env via your shell)
cd ../..
npm run dev:web                       # terminal 1 → http://localhost:3000
npm run dev:worker                    # terminal 2
```

On a fresh database the first user to sign up becomes ADMIN. Users whose email domain is in `INTERNAL_DOMAINS` join the team automatically.

## What works without external credentials

| Feature | Needs |
|---|---|
| Add meetings manually, live notes, paste/upload transcripts, approvals UI, action items | nothing |
| Generate analysis + MOM | `ANTHROPIC_API_KEY` |
| Prepare + "send" customer email | `EMAIL_PROVIDER=dev-outbox` (recorded, **not delivered**) or Graph |
| Detect meetings from a calendar | Graph credentials + a meeting source |
| Notetaker joining Zoom/Teams | Recall key, plus a public URL for webhooks (`ngrok http 3000`, then set `NEXTAUTH_URL` and the Recall webhook to the tunnel) |

### Exercising the MOM flow without an AI key

`apps/worker/src/dev-stub-analysis.ts` runs the real analysis processor with a deterministic stub that only reflects your categorized notes. Its output is marked `[DEV STUB — not AI output]`. It refuses to run with `NODE_ENV=production`.

```bash
cd apps/worker && npx tsx src/dev-stub-analysis.ts <meetingId>
```

## Useful commands

```bash
npm run typecheck                      # all packages
npm run lint                           # web
npm run test --workspaces --if-present # unit tests
RUN_DB_TESTS=1 npm run test --workspace=apps/worker   # DB integration tests (uses DATABASE_URL; cleans up after itself)
npx prisma studio --schema packages/db/prisma/schema.prisma
```

## Notes

- `apps/web` and `apps/worker` both load the **root** `.env` explicitly (npm workspaces don't share it otherwise).
- On Windows, `prisma generate` fails with `EPERM` while the dev server or worker is running (the query-engine DLL is locked). Stop them, generate, restart.
- Schema changes: edit `packages/db/prisma/schema.prisma`, then `npm run db:migrate --workspace=packages/db` (interactive) or `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script` into a new migration folder in non-interactive shells.
