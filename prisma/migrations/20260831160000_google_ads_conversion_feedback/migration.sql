-- CreateEnum
CREATE TYPE "GoogleAdsDataManagerStatus" AS ENUM ('NOT_CONFIGURED', 'READY', 'REAUTH_REQUIRED', 'ERROR');
CREATE TYPE "GoogleAdsConversionFeedbackStatus" AS ENUM ('DRAFT', 'NEEDS_REAUTH', 'NEEDS_ACTION', 'READY', 'ACTIVE', 'DISABLED', 'ERROR');
CREATE TYPE "GoogleAdsConversionEventSource" AS ENUM ('WEB', 'APP', 'IN_STORE', 'PHONE', 'MESSAGE', 'OTHER');
CREATE TYPE "GoogleAdsConversionValuePolicy" AS ENUM ('REVENUE_IF_AVAILABLE', 'REQUIRE_REVENUE', 'NO_VALUE');
CREATE TYPE "GoogleAdsConversionExportStatus" AS ENUM ('PENDING', 'BLOCKED', 'READY', 'SUBMITTING', 'PROCESSING', 'SUCCEEDED', 'REJECTED', 'RETRYABLE_ERROR', 'NEEDS_REVIEW', 'CANCELLED', 'OUT_OF_SYNC');
CREATE TYPE "GoogleAdsConversionExportAttemptKind" AS ENUM ('SUBMIT', 'STATUS');
CREATE TYPE "GoogleAdsConversionOutOfSyncReason" AS ENUM ('REVENUE_CHANGED_AFTER_EXPORT', 'OUTCOME_REVERSED_AFTER_EXPORT');

ALTER TABLE "GoogleAdsConnection"
ADD COLUMN "grantedScopes" TEXT,
ADD COLUMN "dataManagerStatus" "GoogleAdsDataManagerStatus" NOT NULL DEFAULT 'NOT_CONFIGURED';

ALTER TABLE "GoogleAdsOAuthState"
ADD COLUMN "intent" TEXT NOT NULL DEFAULT 'connect',
ADD COLUMN "requestedScopes" TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/adwords';

CREATE TABLE "GoogleAdsConversionActionCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "conversionActionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "countingType" TEXT,
    "clickThroughLookbackWindowDays" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsConversionActionCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsConversionFeedbackConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "googleAdsConnectionId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "conversionActionId" TEXT NOT NULL,
    "conversionActionNameSnapshot" TEXT NOT NULL,
    "conversionActionTypeSnapshot" TEXT,
    "conversionActionCountingType" TEXT,
    "clickThroughLookbackDays" INTEGER,
    "status" "GoogleAdsConversionFeedbackStatus" NOT NULL DEFAULT 'DRAFT',
    "eventSource" "GoogleAdsConversionEventSource" NOT NULL,
    "valuePolicy" "GoogleAdsConversionValuePolicy" NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsConversionFeedbackConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsConversionExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "leadOutcomeId" TEXT NOT NULL,
    "leadAttributionId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "conversionActionId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" "GoogleAdsConversionExportStatus" NOT NULL DEFAULT 'PENDING',
    "blockReason" TEXT,
    "outOfSyncReason" "GoogleAdsConversionOutOfSyncReason",
    "conversionTimestamp" TIMESTAMP(3) NOT NULL,
    "valueAmountMinor" BIGINT,
    "currencyCode" TEXT,
    "identifierTypes" TEXT NOT NULL,
    "eventSource" "GoogleAdsConversionEventSource" NOT NULL,
    "dataManagerRequestId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastStatusCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorCategory" TEXT,
    "lastWarningCodes" TEXT,
    "snapshotLockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsConversionExport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsConversionExportAttempt" (
    "id" TEXT NOT NULL,
    "exportId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "kind" "GoogleAdsConversionExportAttemptKind" NOT NULL,
    "dataManagerRequestId" TEXT,
    "errorCode" TEXT,
    "errorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsConversionExportAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAdsConversionActionCache_googleAdsCustomerId_conversionActionId_key" ON "GoogleAdsConversionActionCache"("googleAdsCustomerId", "conversionActionId");
CREATE INDEX "GoogleAdsConversionActionCache_organizationId_idx" ON "GoogleAdsConversionActionCache"("organizationId");

CREATE UNIQUE INDEX "GoogleAdsConversionFeedbackConfig_websiteId_key" ON "GoogleAdsConversionFeedbackConfig"("websiteId");
CREATE INDEX "GoogleAdsConversionFeedbackConfig_organizationId_status_idx" ON "GoogleAdsConversionFeedbackConfig"("organizationId", "status");
CREATE INDEX "GoogleAdsConversionFeedbackConfig_googleAdsConnectionId_idx" ON "GoogleAdsConversionFeedbackConfig"("googleAdsConnectionId");
CREATE INDEX "GoogleAdsConversionFeedbackConfig_googleAdsCustomerId_idx" ON "GoogleAdsConversionFeedbackConfig"("googleAdsCustomerId");

CREATE UNIQUE INDEX "GoogleAdsConversionExport_transactionId_key" ON "GoogleAdsConversionExport"("transactionId");
CREATE UNIQUE INDEX "GoogleAdsConversionExport_dataManagerRequestId_key" ON "GoogleAdsConversionExport"("dataManagerRequestId");
CREATE UNIQUE INDEX "GoogleAdsConversionExport_leadId_conversionActionId_key" ON "GoogleAdsConversionExport"("leadId", "conversionActionId");
CREATE INDEX "GoogleAdsConversionExport_status_nextAttemptAt_idx" ON "GoogleAdsConversionExport"("status", "nextAttemptAt");
CREATE INDEX "GoogleAdsConversionExport_organizationId_createdAt_idx" ON "GoogleAdsConversionExport"("organizationId", "createdAt");
CREATE INDEX "GoogleAdsConversionExport_configId_status_idx" ON "GoogleAdsConversionExport"("configId", "status");
CREATE INDEX "GoogleAdsConversionExport_leadId_idx" ON "GoogleAdsConversionExport"("leadId");
CREATE INDEX "GoogleAdsConversionExport_websiteId_status_idx" ON "GoogleAdsConversionExport"("websiteId", "status");

CREATE INDEX "GoogleAdsConversionExportAttempt_exportId_createdAt_idx" ON "GoogleAdsConversionExportAttempt"("exportId", "createdAt");

ALTER TABLE "GoogleAdsConversionActionCache" ADD CONSTRAINT "GoogleAdsConversionActionCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionActionCache" ADD CONSTRAINT "GoogleAdsConversionActionCache_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleAdsConversionFeedbackConfig" ADD CONSTRAINT "GoogleAdsConversionFeedbackConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionFeedbackConfig" ADD CONSTRAINT "GoogleAdsConversionFeedbackConfig_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionFeedbackConfig" ADD CONSTRAINT "GoogleAdsConversionFeedbackConfig_googleAdsConnectionId_fkey" FOREIGN KEY ("googleAdsConnectionId") REFERENCES "GoogleAdsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionFeedbackConfig" ADD CONSTRAINT "GoogleAdsConversionFeedbackConfig_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleAdsConversionExport" ADD CONSTRAINT "GoogleAdsConversionExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionExport" ADD CONSTRAINT "GoogleAdsConversionExport_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionExport" ADD CONSTRAINT "GoogleAdsConversionExport_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionExport" ADD CONSTRAINT "GoogleAdsConversionExport_leadOutcomeId_fkey" FOREIGN KEY ("leadOutcomeId") REFERENCES "LeadOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionExport" ADD CONSTRAINT "GoogleAdsConversionExport_leadAttributionId_fkey" FOREIGN KEY ("leadAttributionId") REFERENCES "LeadAttribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsConversionExport" ADD CONSTRAINT "GoogleAdsConversionExport_configId_fkey" FOREIGN KEY ("configId") REFERENCES "GoogleAdsConversionFeedbackConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoogleAdsConversionExportAttempt" ADD CONSTRAINT "GoogleAdsConversionExportAttempt_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "GoogleAdsConversionExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
