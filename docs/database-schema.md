# Database schema

Source of truth: `packages/db/prisma/schema.prisma`. Migrations: `packages/db/prisma/migrations/`. All primary keys are UUIDs; all tables have `createdAt` (and `updatedAt` where rows change).

## SE Copilot core

| Table | Purpose | Key columns |
|---|---|---|
| `teams` | A Solution Engineering team and its settings | `teamDlAddress` (From), `senderMailbox` (Graph sends as), `internalDomains[]`, `timezone`, `botEnabled`, `botDisplayName`, `botJoinOffsetMinutes`, `botEligibleTypes[]`, `noAiMarkers[]`, `botJoinMessage` |
| `team_meeting_sources` | **TeamMeetingSource**: where meetings are discovered | `type` (SHARED_MAILBOX / GROUP_CALENDAR / DELEGATED_CALENDAR / FORWARDED_MAILBOX), `mailboxAddress` or `groupId`, `syncDaysAhead`, `lastSyncedAt/Status/Error/EventCount` |
| `customers` | Customer company | `name`, `domains[]` (matching attendee domains) |
| `meeting_sessions` | A meeting | `userId` (assigned SE), `backupSeUserId`, `teamId`, `customerId`, `sourceId` + `externalEventId` (unique together; the calendar identity), `origin` (CALENDAR/MANUAL), `platform` (ZOOM/TEAMS/OTHER/UNKNOWN), `meetingUrl`, `scheduledAt`, `endsAt`, `meetingType` + `meetingTypeOverridden`, `captureMode`, `botEligible` + `botIneligibleReason` + `botOverride`, `status`, `failureReason` |
| `meeting_participants` | Attendees | `email` (unique per meeting), `name`, `role`, `isExternal` |
| `meeting_bot_sessions` | One notetaker bot | `provider`, `externalBotId` (unique), `status` (SCHEDULED → … → COMPLETED/FAILED/CANCELLED), `joinAt`, `lastStatusCode`, `lastSubCode`, `failureReason`, `transcriptReadyAt` |
| `meeting_notes` | SE notes | `category` (REQUIREMENT, QUESTION, ANSWER, DECISION, ACTION_ITEM, IMPORTANT, FOLLOW_UP, GENERAL), `text`, `authorUserId` |
| `transcripts` / `transcript_segments` | Transcript + speaker turns | `source` (MEETING_BOT, RECORDING_TRANSCRIPTION, UPLOADED_FILE, PASTED_TEXT), segments `speakerLabel`, `startMs`, `endMs`, `text` |
| `meeting_analyses` | AI meeting intelligence | `status`, `contentJson` (`MeetingAnalysisContent`), `inputsJson`, `model`, `failureReason` |
| `moms` | Customer MOM (one per meeting) | `status` (DRAFT, AWAITING_APPROVAL, APPROVED, REJECTED, SENT), `aiMarkdown` (as generated), `markdown` (current), `approvedHash`, `version`, edit/approve/reject actor + time |
| `action_items` | Extracted / manual actions | `description`, `owner`, `dueDate` (only if stated), `dueDateText`, `priority`, `status`, `origin` (ai/manual) |
| `email_messages` | Customer follow-ups | `status` (DRAFT → QUEUED → SENDING → SENT/FAILED, or CANCELLED), `fromAddress`, `senderMailbox`, `toJson`, `ccJson`, `subject`, `bodyHtml`, `bodyText`, `momHash`, `validationJson`, `replyToMessageId`, `providerMessageId`, `confirmedById/At`, `sentAt` |
| `approval_events` | Append-only approval audit trail | `contentType` (MOM / CUSTOMER_EMAIL), `contentId`, `action`, `actorUserId`, `snapshot`, `metadataJson` |

## Platform & infrastructure

| Table | Purpose |
|---|---|
| `users`, `accounts`, `user_sessions`, `verification_tokens`, `password_reset_tokens` | Auth. `users.role` (USER = SE, MANAGER, ADMIN), `users.teamId`, `users.timezone` |
| `meeting_session_events` | Every status transition with source + idempotency key |
| `notifications` | In-app notifications (also emailed best-effort) |
| `audit_logs` | General audit log |
| `background_jobs` | Mirror of job runs for the admin panel |
| `rate_limit_buckets`, `worker_heartbeats` | Replaced Redis |
| `pgboss.*` | pg-boss job queue (managed by pg-boss, not Prisma) |
| `meeting_providers`, `meeting_credentials`, `recordings`, `media_assets`, `meeting_summaries` | From the original Meeting Assistant (Zoom recording pipeline, media library). `meeting_summaries` is superseded by `meeting_analyses` and no longer written |

## Planned (later phases)

`KnowledgeArticle`, `KnowledgeEmbedding` (pgvector), `DailyInsight`, `WeeklyDigest`, `LinkedInDraft`, `PrivacyScan`. The approval trail's `ApprovalContentType` enum is designed to extend to them.
