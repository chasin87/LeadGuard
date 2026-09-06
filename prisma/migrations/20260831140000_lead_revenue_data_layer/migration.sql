-- CreateEnum
CREATE TYPE "LeadOutcomeStatus" AS ENUM ('NEW', 'QUALIFIED', 'WON', 'LOST');
CREATE TYPE "LeadOutcomeChangeType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'REVENUE_CHANGED', 'STATUS_AND_REVENUE_CHANGED');
CREATE TYPE "LeadOutcomeSource" AS ENUM ('MANUAL', 'API', 'CSV_IMPORT', 'CRM_SYNC', 'SYSTEM');
CREATE TYPE "LeadOutcomeActorType" AS ENUM ('USER', 'SYSTEM', 'INTEGRATION');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "defaultRevenueCurrencyCode" TEXT;

-- CreateTable
CREATE TABLE "LeadOutcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "LeadOutcomeStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3) NOT NULL,
    "qualifiedAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "revenueAmountMinor" BIGINT,
    "revenueCurrencyCode" TEXT,
    "revenueSource" "LeadOutcomeSource",
    "revenueUpdatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadOutcome_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadOutcome_leadId_key" UNIQUE ("leadId"),
    CONSTRAINT "LeadOutcome_version_positive" CHECK ("version" > 0),
    CONSTRAINT "LeadOutcome_revenue_pair" CHECK (
        ("revenueAmountMinor" IS NULL AND "revenueCurrencyCode" IS NULL)
        OR ("revenueAmountMinor" IS NOT NULL AND "revenueCurrencyCode" IS NOT NULL)
    ),
    CONSTRAINT "LeadOutcome_revenue_won_only" CHECK (
        "status" = 'WON'
        OR ("revenueAmountMinor" IS NULL AND "revenueCurrencyCode" IS NULL)
    ),
    CONSTRAINT "LeadOutcome_revenue_non_negative" CHECK (
        "revenueAmountMinor" IS NULL OR "revenueAmountMinor" >= 0
    )
);

CREATE TABLE "LeadOutcomeEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changeType" "LeadOutcomeChangeType" NOT NULL,
    "beforeStatus" "LeadOutcomeStatus",
    "afterStatus" "LeadOutcomeStatus" NOT NULL,
    "beforeRevenueAmountMinor" BIGINT,
    "afterRevenueAmountMinor" BIGINT,
    "beforeRevenueCurrencyCode" TEXT,
    "afterRevenueCurrencyCode" TEXT,
    "source" "LeadOutcomeSource" NOT NULL,
    "actorType" "LeadOutcomeActorType" NOT NULL,
    "actorUserId" TEXT,
    "sourceSystem" TEXT,
    "sourceRecordId" TEXT,
    "sourceEventId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadOutcomeEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadOutcomeEvent_outcomeId_mutationId_key" UNIQUE ("outcomeId", "mutationId")
);

-- Backfill existing Fase 13 leads with NEW outcomes and an immutable created event.
INSERT INTO "LeadOutcome" (
    "id",
    "organizationId",
    "websiteId",
    "leadId",
    "status",
    "statusChangedAt",
    "version",
    "createdAt",
    "updatedAt"
)
SELECT
    'lo_' || "id",
    "organizationId",
    "websiteId",
    "id",
    'NEW',
    "occurredAt",
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Lead"
WHERE NOT EXISTS (
    SELECT 1 FROM "LeadOutcome" WHERE "LeadOutcome"."leadId" = "Lead"."id"
);

INSERT INTO "LeadOutcomeEvent" (
    "id",
    "organizationId",
    "websiteId",
    "leadId",
    "outcomeId",
    "mutationId",
    "version",
    "changeType",
    "beforeStatus",
    "afterStatus",
    "source",
    "actorType",
    "effectiveAt",
    "createdAt"
)
SELECT
    'loe_' || "LeadOutcome"."id",
    "LeadOutcome"."organizationId",
    "LeadOutcome"."websiteId",
    "LeadOutcome"."leadId",
    "LeadOutcome"."id",
    'system-created-' || "LeadOutcome"."leadId",
    1,
    'CREATED',
    NULL,
    'NEW',
    'SYSTEM',
    'SYSTEM',
    "LeadOutcome"."statusChangedAt",
    CURRENT_TIMESTAMP
FROM "LeadOutcome"
WHERE NOT EXISTS (
    SELECT 1 FROM "LeadOutcomeEvent"
    WHERE "LeadOutcomeEvent"."outcomeId" = "LeadOutcome"."id"
);

-- Foreign keys
ALTER TABLE "LeadOutcome" ADD CONSTRAINT "LeadOutcome_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadOutcome" ADD CONSTRAINT "LeadOutcome_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadOutcome" ADD CONSTRAINT "LeadOutcome_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LeadOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "LeadOutcome_organizationId_status_idx" ON "LeadOutcome"("organizationId", "status");
CREATE INDEX "LeadOutcome_websiteId_status_idx" ON "LeadOutcome"("websiteId", "status");
CREATE INDEX "LeadOutcome_statusChangedAt_idx" ON "LeadOutcome"("statusChangedAt");
CREATE INDEX "LeadOutcome_organizationId_status_revenueCurrencyCode_idx" ON "LeadOutcome"("organizationId", "status", "revenueCurrencyCode");
CREATE INDEX "LeadOutcomeEvent_outcomeId_createdAt_idx" ON "LeadOutcomeEvent"("outcomeId", "createdAt");
CREATE INDEX "LeadOutcomeEvent_leadId_createdAt_idx" ON "LeadOutcomeEvent"("leadId", "createdAt");
CREATE INDEX "LeadOutcomeEvent_organizationId_idx" ON "LeadOutcomeEvent"("organizationId");
