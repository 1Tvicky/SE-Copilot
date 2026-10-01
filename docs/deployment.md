# Production deployment

## Components

| Component | Notes |
|---|---|
| Postgres 13+ | Managed (Azure Database for PostgreSQL, RDS, Cloud SQL). Storage encryption on. Holds app data **and** the pg-boss queue (schema `pgboss`); the app user needs `CREATE` on the database the first time pg-boss installs its schema |
| `apps/web` | Next.js standalone server (`apps/web/Dockerfile`). Stateless; run ≥2 behind HTTPS |
| `apps/worker` | `node apps/worker/dist/index.js` (`apps/worker/Dockerfile`). Run ≥1; more instances are safe (pg-boss locks jobs; email claims are atomic) |
| Public HTTPS URL | Required for `/api/auth/callback/azure-ad`, `/api/webhooks/recall` and (optional) `/api/webhooks/zoom` |

No Redis is needed.

## Steps

1. Build: `npm ci && npm run build` (on Windows build hosts, stop running processes first — see local-development notes).
2. Migrate: `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` (part of the release, before new code starts).
3. Seed once: `npx tsx packages/db/prisma/seed.ts` with the `TEAM_*` variables. Later changes happen in Settings → Team.
4. Configure env (see `.env.example`). Production must **not** set `EMAIL_PROVIDER=dev-outbox` (the worker refuses to send with it under `NODE_ENV=production`).
5. Microsoft 365 app registration with scoped mailbox access — [setup/microsoft-365.md](setup/microsoft-365.md).
6. Recall workspace + webhook — [setup/notetaker-zoom-teams.md](setup/notetaker-zoom-teams.md).
7. Start web + worker; confirm **Integrations** shows everything green, then do the verify steps in each setup guide with an internal test meeting.

## Operations

- **Health:** Admin → Workers & queues shows live workers (heartbeat within 30 s) and queue depth/failures. Admin → Notetaker shows bot outcomes and the capture success rate.
- **Failed jobs** can be retried from the admin panel, except `email-send`. Customer emails are re-sent only by an SE confirming again.
- **Logs:** the worker logs JSON (pino) with `meetingSessionId`, queue and job id. Ship it to your log platform. Logs never contain secrets or email bodies.
- **Backups:** standard Postgres backups cover everything (data, approval trail, job queue).
- **Scaling:** calendar polling runs once per cron tick regardless of worker count (pg-boss schedules are singletons).
- The Docker images have not been build-tested in this repository's CI; build and smoke-test them in your pipeline.
