-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "MeetingPlatform" AS ENUM ('ZOOM');

-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('AUTHORIZED_GUEST', 'AUTHENTICATED_ACCOUNT');

-- CreateEnum
CREATE TYPE "RecordingPreference" AS ENUM ('NONE', 'CLOUD_RECORDING_IF_AVAILABLE');

-- CreateEnum
CREATE TYPE "MeetingSessionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PREPARING', 'JOINING', 'WAITING_FOR_ADMISSION', 'ACTIVE', 'RECORDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('SYSTEM', 'WEBHOOK', 'USER', 'WORKER');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingFileType" AS ENUM ('VIDEO', 'AUDIO', 'CHAT', 'TRANSCRIPT_VTT');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING', 'AVAILABLE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "SummaryStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('WAITING', 'ACTIVE', 'COMPLETED', 'FAILED', 'DELAYED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MEETING_SCHEDULED', 'MEETING_STARTING', 'JOIN_SUCCEEDED', 'MEETING_COMPLETED', 'MEETING_FAILED', 'RECORDING_READY', 'TRANSCRIPT_READY', 'SUMMARY_READY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionIdHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_providers" (
    "id" TEXT NOT NULL,
    "platform" "MeetingPlatform" NOT NULL,
    "displayName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilitiesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "MeetingPlatform" NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "scope" TEXT,
    "externalAccountId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "MeetingPlatform" NOT NULL,
    "meetingUrl" TEXT NOT NULL,
    "meetingId" TEXT,
    "passcodeEncrypted" TEXT,
    "participantDisplayName" TEXT NOT NULL,
    "participantType" "ParticipantType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "maxDurationMinutes" INTEGER NOT NULL,
    "recordingPreference" "RecordingPreference" NOT NULL DEFAULT 'CLOUD_RECORDING_IF_AVAILABLE',
    "transcriptEnabled" BOOLEAN NOT NULL DEFAULT true,
    "summaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnStatusChange" BOOLEAN NOT NULL DEFAULT true,
    "status" "MeetingSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "externalMeetingUuid" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_session_events" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "fromStatus" "MeetingSessionStatus" NOT NULL,
    "toStatus" "MeetingSessionStatus" NOT NULL,
    "source" "EventSource" NOT NULL,
    "message" TEXT,
    "metadataJson" JSONB,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingSessionId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "storageKey" TEXT NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "fileType" "RecordingFileType" NOT NULL,
    "storageKey" TEXT,
    "fileSizeBytes" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING',
    "externalRecordingId" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "recordingId" TEXT,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "language" TEXT,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_summaries" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT NOT NULL,
    "transcriptId" TEXT,
    "status" "SummaryStatus" NOT NULL DEFAULT 'PENDING',
    "overview" TEXT,
    "topicsJson" JSONB,
    "decisionsJson" JSONB,
    "actionItemsJson" JSONB,
    "questionsJson" JSONB,
    "keyTimestampsJson" JSONB,
    "participantsJson" JSONB,
    "model" TEXT,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3),
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "meetingSessionId" TEXT,
    "queueName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'WAITING',
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingSessionId" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadataJson" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_sessionIdHash_key" ON "user_sessions"("sessionIdHash");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_providers_platform_key" ON "meeting_providers"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_credentials_userId_platform_key" ON "meeting_credentials"("userId", "platform");

-- CreateIndex
CREATE INDEX "meeting_sessions_userId_idx" ON "meeting_sessions"("userId");

-- CreateIndex
CREATE INDEX "meeting_sessions_status_idx" ON "meeting_sessions"("status");

-- CreateIndex
CREATE INDEX "meeting_sessions_scheduledAt_idx" ON "meeting_sessions"("scheduledAt");

-- CreateIndex
CREATE INDEX "meeting_session_events_meetingSessionId_idx" ON "meeting_session_events"("meetingSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_session_events_meetingSessionId_idempotencyKey_key" ON "meeting_session_events"("meetingSessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "media_assets_userId_idx" ON "media_assets"("userId");

-- CreateIndex
CREATE INDEX "media_assets_meetingSessionId_idx" ON "media_assets"("meetingSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_externalRecordingId_key" ON "recordings"("externalRecordingId");

-- CreateIndex
CREATE INDEX "recordings_meetingSessionId_idx" ON "recordings"("meetingSessionId");

-- CreateIndex
CREATE INDEX "transcripts_meetingSessionId_idx" ON "transcripts"("meetingSessionId");

-- CreateIndex
CREATE INDEX "transcript_segments_transcriptId_startMs_idx" ON "transcript_segments"("transcriptId", "startMs");

-- CreateIndex
CREATE INDEX "meeting_summaries_meetingSessionId_idx" ON "meeting_summaries"("meetingSessionId");

-- CreateIndex
CREATE INDEX "background_jobs_status_idx" ON "background_jobs"("status");

-- CreateIndex
CREATE INDEX "background_jobs_meetingSessionId_idx" ON "background_jobs"("meetingSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_queueName_jobId_key" ON "background_jobs"("queueName", "jobId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_credentials" ADD CONSTRAINT "meeting_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "meeting_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_session_events" ADD CONSTRAINT "meeting_session_events_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "transcripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_meetingSessionId_fkey" FOREIGN KEY ("meetingSessionId") REFERENCES "meeting_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
