-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('CUSTOMER_DISCOVERY', 'TECHNICAL_DISCUSSION', 'DEMO', 'POC', 'MIGRATION_DISCUSSION', 'ARCHITECTURE_DISCUSSION', 'PRESALES', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingOrigin" AS ENUM ('CALENDAR', 'MANUAL');

-- CreateEnum
CREATE TYPE "CaptureMode" AS ENUM ('TRANSCRIPT', 'MANUAL_NOTES', 'TRANSCRIPT_AND_NOTES');

-- CreateEnum
CREATE TYPE "TeamMeetingSourceType" AS ENUM ('SHARED_MAILBOX', 'GROUP_CALENDAR', 'DELEGATED_CALENDAR', 'FORWARDED_MAILBOX');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('ORGANIZER', 'REQUIRED', 'OPTIONAL', 'RESOURCE');

-- CreateEnum
CREATE TYPE "BotSessionStatus" AS ENUM ('SCHEDULED', 'JOINING', 'WAITING_FOR_ADMISSION', 'JOINED', 'CAPTURING', 'CALL_ENDED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('RECORDING_TRANSCRIPTION', 'MEETING_BOT', 'UPLOADED_FILE', 'PASTED_TEXT');

-- CreateEnum
CREATE TYPE "NoteCategory" AS ENUM ('GENERAL', 'REQUIREMENT', 'QUESTION', 'ANSWER', 'DECISION', 'ACTION_ITEM', 'IMPORTANT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MomStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT');

-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ActionItemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('CUSTOMER_MOM');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalContentType" AS ENUM ('MOM', 'CUSTOMER_EMAIL');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('AI_GENERATED', 'REGENERATED', 'EDITED', 'SUBMITTED_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'EMAIL_PREPARED', 'SEND_CONFIRMED', 'SENT', 'SEND_FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MeetingPlatform" ADD VALUE 'TEAMS';
ALTER TYPE "MeetingPlatform" ADD VALUE 'OTHER';
ALTER TYPE "MeetingPlatform" ADD VALUE 'UNKNOWN';

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'IN_APP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BOT_JOINED';
ALTER TYPE "NotificationType" ADD VALUE 'BOT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'ANALYSIS_READY';
ALTER TYPE "NotificationType" ADD VALUE 'MOM_READY';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'EMAIL_SENT';
ALTER TYPE "NotificationType" ADD VALUE 'EMAIL_FAILED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGER';

-- DropForeignKey
ALTER TABLE "meeting_sessions" DROP CONSTRAINT "meeting_sessions_providerId_fkey";

-- AlterTable
ALTER TABLE "meeting_sessions" ADD COLUMN     "backupSeUserId" TEXT,
ADD COLUMN     "botEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botIneligibleReason" TEXT,
ADD COLUMN     "botOverride" BOOLEAN,
ADD COLUMN     "calendarLastModifiedAt" TIMESTAMP(3),
ADD COLUMN     "captureMode" "CaptureMode" NOT NULL DEFAULT 'TRANSCRIPT_AND_NOTES',
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "externalEventId" TEXT,
ADD COLUMN     "iCalUId" TEXT,
ADD COLUMN     "meetingType" "MeetingType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "meetingTypeOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizerEmail" TEXT,
ADD COLUMN     "organizerName" TEXT,
ADD COLUMN     "origin" "MeetingOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "teamId" TEXT,
ALTER COLUMN "providerId" DROP NOT NULL,
ALTER COLUMN "meetingUrl" DROP NOT NULL,
ALTER COLUMN "participantDisplayName" SET DEFAULT 'SE Copilot Notetaker',
ALTER COLUMN "participantType" SET DEFAULT 'AUTHORIZED_GUEST',
ALTER COLUMN "timezone" SET DEFAULT 'UTC',
ALTER COLUMN "maxDurationMinutes" SET DEFAULT 60;

-- AlterTable
ALTER TABLE "transcripts" ADD COLUMN     "source" "TranscriptSource" NOT NULL DEFAULT 'RECORDING_TRANSCRIPTION';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailSignature" TEXT,
ADD COLUMN     "teamId" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamDlAddress" TEXT,
    "teamDlDisplayName" TEXT,
    "senderMailbox" TEXT,
    "emailSignature" TEXT,
    "internalDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "botDisplayName" TEXT NOT NULL DEFAULT 'SE Copilot Notetaker',
    "botJoinOffsetMinutes" INTEGER NOT NULL DEFAULT 1,
    "botEligibleTypes" "MeetingType"[] DEFAULT ARRAY['CUSTOMER_DISCOVERY', 'TECHNICAL_DISCUSSION', 'DEMO', 'POC', 'MIGRATION_DISCUSSION', 'ARCHITECTURE_DISCUSSION', 'PRESALES']::"MeetingType"[],
    "noAiMarkers" TEXT[] DEFAULT ARRAY['no ai', 'no-ai', '#noai', 'no recording', 'no notetaker']::TEXT[],
    "botJoinMessage" TEXT NOT NULL DEFAULT 'Hi all - SE Copilot Notetaker (an AI assistant) has joined to transcribe this meeting for the Solution Engineering team''s notes. Let us know if you would prefer it to leave.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_meeting_sources" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "TeamMeetingSourceType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "mailboxAddress" TEXT,
    "groupId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncDaysAhead" INTEGER NOT NULL DEFAULT 14,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "lastSyncEventCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_meeting_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "ParticipantRole" NOT NULL DEFAULT 'REQUIRED',
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "responseStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_bot_sessions" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalBotId" TEXT,
    "status" "BotSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "botName" TEXT NOT NULL,
    "joinAt" TIMESTAMP(3),
    "lastStatusCode" TEXT,
    "lastSubCode" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "transcriptReadyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_notes" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "category" "NoteCategory" NOT NULL DEFAULT 'GENERAL',
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_analyses" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "contentJson" JSONB,
    "inputsJson" JSONB,
    "model" TEXT,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moms" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "analysisId" TEXT,
    "status" "MomStatus" NOT NULL DEFAULT 'DRAFT',
    "aiMarkdown" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "approvedHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_items" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "customerId" TEXT,
    "description" TEXT NOT NULL,
    "owner" TEXT,
    "dueDate" TIMESTAMP(3),
    "dueDateText" TEXT,
    "priority" "ActionItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "origin" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "meetingSessionId" TEXT,
    "momId" TEXT,
    "kind" "EmailKind" NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'DRAFT',
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "senderMailbox" TEXT NOT NULL,
    "toJson" JSONB NOT NULL,
    "ccJson" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "momHash" TEXT,
    "validationJson" JSONB,
    "replyToMessageId" TEXT,
    "providerMessageId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_events" (
    "id" TEXT NOT NULL,
    "contentType" "ApprovalContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "meetingSessionId" TEXT,
    "action" "ApprovalAction" NOT NULL,
    "actorUserId" TEXT,
    "snapshot" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE INDEX "team_meeting_sources_teamId_idx" ON "team_meeting_sources"("teamId");

-- CreateIndex
CREATE INDEX "customers_teamId_idx" ON "customers"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meetingSessionId_email_key" ON "meeting_participants"("meetingSessionId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_bot_sessions_externalBotId_key" ON "meeting_bot_sessions"("externalBotId");

-- CreateIndex
CREATE INDEX "meeting_bot_sessions_meetingSessionId_idx" ON "meeting_bot_sessions"("meetingSessionId");

-- CreateIndex
CREATE INDEX "meeting_bot_sessions_status_idx" ON "meeting_bot_sessions"("status");

-- CreateIndex
CREATE INDEX "meeting_notes_meetingSessionId_createdAt_idx" ON "meeting_notes"("meetingSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "meeting_analyses_meetingSessionId_createdAt_idx" ON "meeting_analyses"("meetingSessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "moms_meetingSessionId_key" ON "moms"("meetingSessionId");

-- CreateIndex
CREATE INDEX "moms_status_idx" ON "moms"("status");

-- CreateIndex
CREATE INDEX "action_items_meetingSessionId_idx" ON "action_items"("meetingSessionId");

-- CreateIndex
CREATE INDEX "action_items_status_idx" ON "action_items"("status");

-- CreateIndex
CREATE INDEX "email_messages_meetingSessionId_idx" ON "email_messages"("meetingSessionId");

-- CreateIndex
CREATE INDEX "email_messages_status_idx" ON "email_messages"("status");

-- CreateIndex
CREATE INDEX "approval_events_contentType_contentId_createdAt_idx" ON "approval_events"("contentType", "contentId", "createdAt");

-- CreateIndex
CREATE INDEX "approval_events_meetingSessionId_idx" ON "approval_events"("meetingSessionId");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");

-- CreateIndex
CREATE INDEX "meeting_sessions_teamId_idx" ON "meeting_sessions"("teamId");

-- CreateIndex
CREATE INDEX "meeting_sessions_customerId_idx" ON "meeting_sessions"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_sessions_sourceId_externalEventId_key" ON "meeting_sessions"("sourceId", "externalEventId");

-- CreateIndex
CREATE INDEX "users_teamId_idx" ON "users"("teamId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_backupSeUserId_fkey" FOREIGN KEY ("backupSeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "meeting_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "team_meeting_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_meeting_sources" ADD CONSTRAINT "team_meeting_sources_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_bot_sessions" ADD CONSTRAINT "meeting_bot_sessions_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_analyses" ADD CONSTRAINT "meeting_analyses_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moms" ADD CONSTRAINT "moms_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_momId_fkey" FOREIGN KEY ("momId") REFERENCES "moms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

