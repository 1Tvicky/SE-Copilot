# Testing

| Layer | Command | Covers |
|---|---|---|
| Shared unit tests (89) | `npm run test --workspace=packages/shared` | Platform detection (Teams/Zoom/Safe Links/vanity rooms), classification, customer-domain detection, eligibility rules + overrides, join timing, state machine, Recall status mapping, transcript parsing (VTT voice tags, SRT, plain), analysis schema, MOM structure + internal-section exclusion, HTML escaping, follow-up email, pre-send validation, API input schemas |
| Web unit tests (21) | `npm run test --workspace=apps/web` | Recall webhook signatures (valid, rotated keys, tampering, wrong secret, replay), Zoom webhook signatures, passwords, timezone day bounds, formatting |
| Worker unit tests (7) | `npm run test --workspace=apps/worker` | Zoom URL parsing, meeting date formatting, transcript offsets |
| **Pipeline integration (5)** | `RUN_DB_TESTS=1 npm run test --workspace=apps/worker` | Against real Postgres: calendar ingest (platform, customer, type, assignment, eligibility, idempotent re-sync, reschedule detection, cancellation); FAILED-capture recovery → analysis → action items → MOM awaiting approval; approved + confirmed email sent exactly once (duplicate job is a no-op); send refused when the MOM changed after approval; bot webhooks → waiting room → lobby timeout → capture unavailable, and late events ignored |
| E2E (Playwright) | `npm run test:e2e --workspace=apps/web` (app + worker running) | Sign-up into the team, add a meeting, customer detection, keyboard notes including rapid back-to-back saves, transcript paste, cancel |

The integration suite uses a deterministic AI stub and the dev-outbox email provider. It namespaces everything it creates and deletes it afterwards.

## Not covered automatically

- Live calls to Microsoft Graph, Recall.ai and Anthropic (they need real accounts and cost money). Each setup guide has a manual **Verify** section; run it in a test tenant before going live and after changing credentials.
- Real Zoom/Teams admission behaviour (lobbies, host permission prompts).

## Spec checklist mapping (MVP)

| Spec area | Where tested |
|---|---|
| Meeting synchronization, detection, classification | `meeting-rules.test.ts`, pipeline integration |
| Bot scheduling, joining, failure handling, platform detection | `meeting-rules.test.ts` (join time, eligibility), `bot-transcript.test.ts`, pipeline integration |
| Notes creation/categorization | E2E |
| Transcript analysis, MOM generation, action-item extraction | `mom-email.test.ts`, pipeline integration (stub AI) |
| Draft generation, recipient validation, approval, sending | `mom-email.test.ts`, pipeline integration, manual dev-outbox run |
| Approval audit logging | pipeline integration (`approval_events` assertions) |
