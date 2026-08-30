-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('INCIDENT_OPENED', 'INCIDENT_RESOLVED', 'NOTIFICATION_TEST');
CREATE TYPE "NotificationChannelType" AS ENUM ('EMAIL', 'WEBHOOK');
CREATE TYPE "NotificationChannelStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "NotificationErrorType" AS ENUM (
  'AUTH_ERROR',
  'CONNECTION_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'RECIPIENT_REJECTED',
  'UNSAFE_TARGET',
  'PERMANENT_HTTP_ERROR',
  'PROVIDER_ERROR',
  'UNKNOWN'
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "NotificationChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "notifyOnOpened" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnResolved" BOOLEAN NOT NULL DEFAULT true,
    "emailAddress" TEXT,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationChannel_organizationId_status_idx" ON "NotificationChannel"("organizationId", "status");
CREATE INDEX "NotificationChannel_organizationId_idx" ON "NotificationChannel"("organizationId");

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_type_fields"
  CHECK (
    ("type" = 'EMAIL' AND "emailAddress" IS NOT NULL AND "webhookUrl" IS NULL AND "webhookSecret" IS NULL)
    OR ("type" = 'WEBHOOK' AND "webhookUrl" IS NOT NULL AND "webhookSecret" IS NOT NULL AND "emailAddress" IS NULL)
  );

-- CreateTable
CREATE TABLE "NotificationOutboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOutboxEvent_aggregateId_eventType_key"
  ON "NotificationOutboxEvent"("aggregateId", "eventType");
CREATE INDEX "NotificationOutboxEvent_status_availableAt_idx"
  ON "NotificationOutboxEvent"("status", "availableAt");
CREATE INDEX "NotificationOutboxEvent_organizationId_idx"
  ON "NotificationOutboxEvent"("organizationId");

ALTER TABLE "NotificationOutboxEvent"
  ADD CONSTRAINT "NotificationOutboxEvent_incident_events"
  CHECK ("eventType" IN ('INCIDENT_OPENED', 'INCIDENT_RESOLVED'));

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT,
    "channelId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastErrorType" "NotificationErrorType",
    "lastErrorMessage" TEXT,
    "websiteName" TEXT,
    "monitorName" TEXT,
    "monitorUrl" TEXT,
    "channelName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDelivery_idempotencyKey_key"
  ON "NotificationDelivery"("idempotencyKey");
CREATE INDEX "NotificationDelivery_organizationId_createdAt_idx"
  ON "NotificationDelivery"("organizationId", "createdAt");
CREATE INDEX "NotificationDelivery_incidentId_idx"
  ON "NotificationDelivery"("incidentId");
CREATE INDEX "NotificationDelivery_channelId_idx"
  ON "NotificationDelivery"("channelId");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt");

ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationOutboxEvent" ADD CONSTRAINT "NotificationOutboxEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
