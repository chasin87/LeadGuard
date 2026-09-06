-- CreateEnum
CREATE TYPE "ExternalOutcomeIntegrationType" AS ENUM ('API', 'WEBHOOK', 'FILE_IMPORT');
CREATE TYPE "ExternalOutcomeIntegrationStatus" AS ENUM ('ENABLED', 'DISABLED');
CREATE TYPE "ExternalOutcomeAuthMode" AS ENUM ('BEARER', 'HMAC');
CREATE TYPE "ExternalOutcomeEventStatus" AS ENUM ('RECEIVED', 'APPLIED', 'DUPLICATE', 'UNMATCHED', 'AMBIGUOUS', 'STALE', 'CONFLICT', 'REJECTED', 'IGNORED');
CREATE TYPE "ExternalLeadMatchMethod" AS ENUM ('EXTERNAL_LEAD_ID', 'PUBLIC_LEAD_ID', 'SOURCE_RECORD_LINK', 'MANUAL');
CREATE TYPE "OutcomeImportStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');
CREATE TYPE "OutcomeImportFileType" AS ENUM ('CSV', 'XLSX');

CREATE TABLE "ExternalOutcomeIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExternalOutcomeIntegrationType" NOT NULL,
    "status" "ExternalOutcomeIntegrationStatus" NOT NULL DEFAULT 'ENABLED',
    "authMode" "ExternalOutcomeAuthMode" NOT NULL DEFAULT 'BEARER',
    "sourceSystem" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "credentialPrefix" TEXT NOT NULL,
    "previousCredentialHash" TEXT,
    "previousCredentialExpiresAt" TIMESTAMP(3),
    "signingSecretHash" TEXT,
    "signingSecretCiphertext" TEXT,
    "lastEventReceivedAt" TIMESTAMP(3),
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalOutcomeIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalOutcomeIntegrationWebsite" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ExternalOutcomeIntegrationWebsite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalLeadLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "matchMethod" "ExternalLeadMatchMethod" NOT NULL,
    "lastAppliedEffectiveAt" TIMESTAMP(3),
    "lastAppliedSourceEventId" TEXT,
    "lastAppliedSourceVersion" INTEGER,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalLeadLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalOutcomeEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "sourceVersion" INTEGER,
    "externalLeadId" TEXT,
    "publicLeadId" TEXT,
    "normalizedStatus" "LeadOutcomeStatus",
    "effectiveAt" TIMESTAMP(3),
    "revenueAmountMinor" BIGINT,
    "revenueCurrencyCode" TEXT,
    "hasRevenue" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExternalOutcomeEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "matchMethod" "ExternalLeadMatchMethod",
    "matchedLeadId" TEXT,
    "appliedOutcomeEventId" TEXT,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalOutcomeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutcomeImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" "OutcomeImportFileType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL,
    "status" "OutcomeImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "staleRows" INTEGER NOT NULL DEFAULT 0,
    "conflictRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutcomeImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutcomeImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "status" "ExternalOutcomeEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorCode" TEXT,
    "matchedLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeImportRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalOutcomeIntegration_credentialHash_key" ON "ExternalOutcomeIntegration"("credentialHash");
CREATE UNIQUE INDEX "ExternalOutcomeIntegration_previousCredentialHash_key" ON "ExternalOutcomeIntegration"("previousCredentialHash");
CREATE INDEX "ExternalOutcomeIntegration_organizationId_status_idx" ON "ExternalOutcomeIntegration"("organizationId", "status");

CREATE UNIQUE INDEX "ExternalOutcomeIntegrationWebsite_integrationId_websiteId_key" ON "ExternalOutcomeIntegrationWebsite"("integrationId", "websiteId");
CREATE INDEX "ExternalOutcomeIntegrationWebsite_websiteId_idx" ON "ExternalOutcomeIntegrationWebsite"("websiteId");

CREATE UNIQUE INDEX "ExternalLeadLink_integrationId_sourceRecordId_key" ON "ExternalLeadLink"("integrationId", "sourceRecordId");
CREATE INDEX "ExternalLeadLink_leadId_idx" ON "ExternalLeadLink"("leadId");
CREATE INDEX "ExternalLeadLink_organizationId_idx" ON "ExternalLeadLink"("organizationId");

CREATE UNIQUE INDEX "ExternalOutcomeEvent_integrationId_sourceEventId_key" ON "ExternalOutcomeEvent"("integrationId", "sourceEventId");
CREATE INDEX "ExternalOutcomeEvent_organizationId_status_idx" ON "ExternalOutcomeEvent"("organizationId", "status");
CREATE INDEX "ExternalOutcomeEvent_integrationId_sourceRecordId_idx" ON "ExternalOutcomeEvent"("integrationId", "sourceRecordId");
CREATE INDEX "ExternalOutcomeEvent_matchedLeadId_idx" ON "ExternalOutcomeEvent"("matchedLeadId");
CREATE INDEX "ExternalOutcomeEvent_integrationId_sourceRecordId_effectiveAt_idx" ON "ExternalOutcomeEvent"("integrationId", "sourceRecordId", "effectiveAt");

CREATE INDEX "OutcomeImport_organizationId_createdAt_idx" ON "OutcomeImport"("organizationId", "createdAt");
CREATE INDEX "OutcomeImport_status_idx" ON "OutcomeImport"("status");
CREATE UNIQUE INDEX "OutcomeImportRow_importId_rowNumber_key" ON "OutcomeImportRow"("importId", "rowNumber");
CREATE INDEX "OutcomeImportRow_importId_status_idx" ON "OutcomeImportRow"("importId", "status");

ALTER TABLE "ExternalOutcomeIntegration" ADD CONSTRAINT "ExternalOutcomeIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalOutcomeIntegrationWebsite" ADD CONSTRAINT "ExternalOutcomeIntegrationWebsite_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalOutcomeIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalOutcomeIntegrationWebsite" ADD CONSTRAINT "ExternalOutcomeIntegrationWebsite_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLeadLink" ADD CONSTRAINT "ExternalLeadLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLeadLink" ADD CONSTRAINT "ExternalLeadLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalOutcomeIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLeadLink" ADD CONSTRAINT "ExternalLeadLink_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalOutcomeEvent" ADD CONSTRAINT "ExternalOutcomeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalOutcomeEvent" ADD CONSTRAINT "ExternalOutcomeEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalOutcomeIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalOutcomeEvent" ADD CONSTRAINT "ExternalOutcomeEvent_matchedLeadId_fkey" FOREIGN KEY ("matchedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutcomeImport" ADD CONSTRAINT "OutcomeImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutcomeImport" ADD CONSTRAINT "OutcomeImport_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalOutcomeIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutcomeImport" ADD CONSTRAINT "OutcomeImport_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutcomeImportRow" ADD CONSTRAINT "OutcomeImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "OutcomeImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
