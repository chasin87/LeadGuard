-- CreateEnum
CREATE TYPE "GoogleAdsAnalyticsConfigStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'NEEDS_REAUTH', 'ERROR');

-- CreateEnum
CREATE TYPE "GoogleAdsAnalyticsSyncKind" AS ENUM ('RECENT', 'BACKFILL', 'MANUAL');

-- CreateEnum
CREATE TYPE "GoogleAdsAnalyticsSyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "GoogleAdsPerformanceDimension" AS ENUM ('ACCOUNT', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "GoogleAdsLeadAttributionResolutionStatus" AS ENUM ('PENDING', 'ACCOUNT_RESOLVED', 'CAMPAIGN_RESOLVED', 'UNSUPPORTED_IDENTIFIER', 'NOT_FOUND', 'OUTSIDE_LOOKBACK', 'AMBIGUOUS', 'ERROR');

-- CreateEnum
CREATE TYPE "GoogleAdsLeadAttributionResolutionMethod" AS ENUM ('GCLID_CLICK_VIEW', 'WEBSITE_ACCOUNT_MAPPING', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "GoogleAdsAnalyticsConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "googleAdsConnectionId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "status" "GoogleAdsAnalyticsConfigStatus" NOT NULL DEFAULT 'DRAFT',
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastManualRefreshAt" TIMESTAMP(3),
    "lastBackfillAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsAnalyticsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAdsPerformanceDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimensionType" "GoogleAdsPerformanceDimension" NOT NULL,
    "campaignId" TEXT NOT NULL DEFAULT '',
    "campaignNameSnapshot" TEXT,
    "campaignStatus" TEXT,
    "advertisingChannelType" TEXT,
    "costMicros" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "impressions" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "customerTimeZone" TEXT NOT NULL,
    "syncRunId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsPerformanceDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAdsAnalyticsSyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "configId" TEXT,
    "kind" "GoogleAdsAnalyticsSyncKind" NOT NULL,
    "status" "GoogleAdsAnalyticsSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "rangeFrom" DATE NOT NULL,
    "rangeThrough" DATE NOT NULL,
    "accountRows" INTEGER NOT NULL DEFAULT 0,
    "campaignRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsAnalyticsSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAdsLeadAttributionResolution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "leadAttributionId" TEXT NOT NULL,
    "attributionTouchId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "status" "GoogleAdsLeadAttributionResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionMethod" "GoogleAdsLeadAttributionResolutionMethod" NOT NULL DEFAULT 'UNRESOLVED',
    "acquisitionAt" TIMESTAMP(3) NOT NULL,
    "googleClickDate" DATE,
    "campaignId" TEXT,
    "campaignNameSnapshot" TEXT,
    "adGroupId" TEXT,
    "adGroupNameSnapshot" TEXT,
    "adId" TEXT,
    "keywordCriterionId" TEXT,
    "keywordTextSnapshot" TEXT,
    "keywordMatchType" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsLeadAttributionResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAdsAnalyticsConfig_websiteId_key" ON "GoogleAdsAnalyticsConfig"("websiteId");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsConfig_organizationId_status_idx" ON "GoogleAdsAnalyticsConfig"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsConfig_googleAdsCustomerId_status_idx" ON "GoogleAdsAnalyticsConfig"("googleAdsCustomerId", "status");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsConfig_status_nextSyncAt_idx" ON "GoogleAdsAnalyticsConfig"("status", "nextSyncAt");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsConfig_googleAdsConnectionId_idx" ON "GoogleAdsAnalyticsConfig"("googleAdsConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAdsPerformanceDaily_googleAdsCustomerId_date_dimensionType_campaignId_key" ON "GoogleAdsPerformanceDaily"("googleAdsCustomerId", "date", "dimensionType", "campaignId");

-- CreateIndex
CREATE INDEX "GoogleAdsPerformanceDaily_googleAdsCustomerId_date_idx" ON "GoogleAdsPerformanceDaily"("googleAdsCustomerId", "date");

-- CreateIndex
CREATE INDEX "GoogleAdsPerformanceDaily_googleAdsCustomerId_campaignId_date_idx" ON "GoogleAdsPerformanceDaily"("googleAdsCustomerId", "campaignId", "date");

-- CreateIndex
CREATE INDEX "GoogleAdsPerformanceDaily_organizationId_date_idx" ON "GoogleAdsPerformanceDaily"("organizationId", "date");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsSyncRun_googleAdsCustomerId_startedAt_idx" ON "GoogleAdsAnalyticsSyncRun"("googleAdsCustomerId", "startedAt");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsSyncRun_organizationId_startedAt_idx" ON "GoogleAdsAnalyticsSyncRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "GoogleAdsAnalyticsSyncRun_status_startedAt_idx" ON "GoogleAdsAnalyticsSyncRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAdsLeadAttributionResolution_leadId_key" ON "GoogleAdsLeadAttributionResolution"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAdsLeadAttributionResolution_leadAttributionId_key" ON "GoogleAdsLeadAttributionResolution"("leadAttributionId");

-- CreateIndex
CREATE INDEX "GoogleAdsLeadAttributionResolution_googleAdsCustomerId_campaignId_idx" ON "GoogleAdsLeadAttributionResolution"("googleAdsCustomerId", "campaignId");

-- CreateIndex
CREATE INDEX "GoogleAdsLeadAttributionResolution_status_nextAttemptAt_idx" ON "GoogleAdsLeadAttributionResolution"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "GoogleAdsLeadAttributionResolution_attributionTouchId_idx" ON "GoogleAdsLeadAttributionResolution"("attributionTouchId");

-- CreateIndex
CREATE INDEX "GoogleAdsLeadAttributionResolution_organizationId_status_idx" ON "GoogleAdsLeadAttributionResolution"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GoogleAdsLeadAttributionResolution_websiteId_idx" ON "GoogleAdsLeadAttributionResolution"("websiteId");

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsConfig" ADD CONSTRAINT "GoogleAdsAnalyticsConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsConfig" ADD CONSTRAINT "GoogleAdsAnalyticsConfig_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsConfig" ADD CONSTRAINT "GoogleAdsAnalyticsConfig_googleAdsConnectionId_fkey" FOREIGN KEY ("googleAdsConnectionId") REFERENCES "GoogleAdsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsConfig" ADD CONSTRAINT "GoogleAdsAnalyticsConfig_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsPerformanceDaily" ADD CONSTRAINT "GoogleAdsPerformanceDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsPerformanceDaily" ADD CONSTRAINT "GoogleAdsPerformanceDaily_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsSyncRun" ADD CONSTRAINT "GoogleAdsAnalyticsSyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsSyncRun" ADD CONSTRAINT "GoogleAdsAnalyticsSyncRun_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsAnalyticsSyncRun" ADD CONSTRAINT "GoogleAdsAnalyticsSyncRun_configId_fkey" FOREIGN KEY ("configId") REFERENCES "GoogleAdsAnalyticsConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsLeadAttributionResolution" ADD CONSTRAINT "GoogleAdsLeadAttributionResolution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsLeadAttributionResolution" ADD CONSTRAINT "GoogleAdsLeadAttributionResolution_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsLeadAttributionResolution" ADD CONSTRAINT "GoogleAdsLeadAttributionResolution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsLeadAttributionResolution" ADD CONSTRAINT "GoogleAdsLeadAttributionResolution_leadAttributionId_fkey" FOREIGN KEY ("leadAttributionId") REFERENCES "LeadAttribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsLeadAttributionResolution" ADD CONSTRAINT "GoogleAdsLeadAttributionResolution_attributionTouchId_fkey" FOREIGN KEY ("attributionTouchId") REFERENCES "AttributionTouch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAdsLeadAttributionResolution" ADD CONSTRAINT "GoogleAdsLeadAttributionResolution_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
