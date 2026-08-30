-- CreateEnum
CREATE TYPE "GoogleAdsImpactStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PARTIAL', 'UNAVAILABLE', 'ERROR');
CREATE TYPE "GoogleAdsAttributionMethod" AS ENUM ('SOURCE_HOURLY', 'SOURCE_HOURLY_PRORATED', 'DESTINATION_REPORTED_DAILY', 'MIXED', 'UNAVAILABLE');
CREATE TYPE "GoogleAdsImpactConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNAVAILABLE');
CREATE TYPE "GoogleAdsImpactSourceCoverage" AS ENUM ('ATTRIBUTED', 'AMBIGUOUS', 'UNSUPPORTED');

-- CreateTable
CREATE TABLE "GoogleAdsIncidentImpact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "destinationTargetId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "status" "GoogleAdsImpactStatus" NOT NULL DEFAULT 'PENDING',
    "attributionMethod" "GoogleAdsAttributionMethod" NOT NULL DEFAULT 'UNAVAILABLE',
    "confidence" "GoogleAdsImpactConfidence" NOT NULL DEFAULT 'UNAVAILABLE',
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "dataIncomplete" BOOLEAN NOT NULL DEFAULT false,
    "currencyCode" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndedAt" TIMESTAMP(3),
    "windowCostMicros" BIGINT,
    "windowClicksMilli" BIGINT,
    "windowClicksEstimated" BOOLEAN NOT NULL DEFAULT false,
    "windowImpressions" BIGINT,
    "destinationDailyCostMicros" BIGINT,
    "destinationDailyClicks" BIGINT,
    "destinationDailyImpressions" BIGINT,
    "destinationDailyFrom" TEXT,
    "destinationDailyTo" TEXT,
    "totalRelevantSources" INTEGER NOT NULL DEFAULT 0,
    "attributedSources" INTEGER NOT NULL DEFAULT 0,
    "ambiguousSources" INTEGER NOT NULL DEFAULT 0,
    "dataFrom" TIMESTAMP(3),
    "dataThrough" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "lastManualRefreshAt" TIMESTAMP(3),
    "nextRefreshAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "diagnosticCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsIncidentImpact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsIncidentImpactSource" (
    "id" TEXT NOT NULL,
    "impactId" TEXT NOT NULL,
    "sourceType" "GoogleAdsSourceType" NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "adGroupId" TEXT,
    "adId" TEXT,
    "assetGroupId" TEXT,
    "coverageStatus" "GoogleAdsImpactSourceCoverage" NOT NULL,
    "method" "GoogleAdsAttributionMethod" NOT NULL,
    "confidence" "GoogleAdsImpactConfidence" NOT NULL,
    "costMicros" BIGINT,
    "clicksMilli" BIGINT,
    "impressions" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsIncidentImpactSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAdsIncidentImpact_incidentId_key" ON "GoogleAdsIncidentImpact"("incidentId");
CREATE INDEX "GoogleAdsIncidentImpact_googleAdsCustomerId_idx" ON "GoogleAdsIncidentImpact"("googleAdsCustomerId");
CREATE INDEX "GoogleAdsIncidentImpact_status_idx" ON "GoogleAdsIncidentImpact"("status");
CREATE INDEX "GoogleAdsIncidentImpact_lastRefreshedAt_idx" ON "GoogleAdsIncidentImpact"("lastRefreshedAt");
CREATE INDEX "GoogleAdsIncidentImpact_nextRefreshAt_idx" ON "GoogleAdsIncidentImpact"("nextRefreshAt");
CREATE INDEX "GoogleAdsIncidentImpact_organizationId_idx" ON "GoogleAdsIncidentImpact"("organizationId");
CREATE INDEX "GoogleAdsIncidentImpact_monitorId_idx" ON "GoogleAdsIncidentImpact"("monitorId");
CREATE UNIQUE INDEX "GoogleAdsIncidentImpactSource_impactId_sourceType_sourceEntityId_key" ON "GoogleAdsIncidentImpactSource"("impactId", "sourceType", "sourceEntityId");
CREATE INDEX "GoogleAdsIncidentImpactSource_impactId_idx" ON "GoogleAdsIncidentImpactSource"("impactId");

ALTER TABLE "GoogleAdsIncidentImpact" ADD CONSTRAINT "GoogleAdsIncidentImpact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsIncidentImpact" ADD CONSTRAINT "GoogleAdsIncidentImpact_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsIncidentImpact" ADD CONSTRAINT "GoogleAdsIncidentImpact_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsIncidentImpact" ADD CONSTRAINT "GoogleAdsIncidentImpact_destinationTargetId_fkey" FOREIGN KEY ("destinationTargetId") REFERENCES "GoogleAdsDestinationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsIncidentImpact" ADD CONSTRAINT "GoogleAdsIncidentImpact_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsIncidentImpactSource" ADD CONSTRAINT "GoogleAdsIncidentImpactSource_impactId_fkey" FOREIGN KEY ("impactId") REFERENCES "GoogleAdsIncidentImpact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
