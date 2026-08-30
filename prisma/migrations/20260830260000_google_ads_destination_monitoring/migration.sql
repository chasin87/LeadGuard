-- AlterEnum
ALTER TYPE "MonitorType" ADD VALUE 'AD_DESTINATION';

-- CreateEnum
CREATE TYPE "GoogleAdsConnectionStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "GoogleAdsCustomerStatus" AS ENUM ('ACTIVE', 'ACCESS_LOST', 'DISABLED');
CREATE TYPE "GoogleAdsDestinationApprovalStatus" AS ENUM ('NEEDS_APPROVAL', 'APPROVED', 'IGNORED', 'UNSUPPORTED', 'BLOCKED');
CREATE TYPE "GoogleAdsDestinationUrlType" AS ENUM ('FINAL_URL', 'MOBILE_FINAL_URL', 'OBSERVED_EXPANDED_URL');
CREATE TYPE "GoogleAdsSourceType" AS ENUM ('AD_GROUP_AD', 'ASSET_GROUP', 'EXPANDED_LANDING_PAGE');
CREATE TYPE "GoogleAdsUrlProvenance" AS ENUM ('CONFIGURED_FINAL_URL', 'CONFIGURED_MOBILE_URL', 'OBSERVED_EXPANDED_URL');
CREATE TYPE "GoogleAdsSyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "GoogleAdsConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "GoogleAdsConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "encryptedRefreshToken" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "googleAccountEmail" TEXT,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "googleCustomerId" TEXT NOT NULL,
    "loginCustomerId" TEXT,
    "descriptiveName" TEXT NOT NULL,
    "currencyCode" TEXT,
    "timeZone" TEXT,
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "status" "GoogleAdsCustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "syncGeneration" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsDestinationTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "monitoringUrl" TEXT,
    "normalizedUrl" TEXT NOT NULL,
    "urlType" "GoogleAdsDestinationUrlType" NOT NULL,
    "websiteId" TEXT,
    "monitorId" TEXT,
    "approvalStatus" "GoogleAdsDestinationApprovalStatus" NOT NULL,
    "hasActiveSource" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsDestinationTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsDestinationReference" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "googleAdsCustomerId" TEXT NOT NULL,
    "sourceType" "GoogleAdsSourceType" NOT NULL,
    "sourceEntityKey" TEXT NOT NULL,
    "provenance" "GoogleAdsUrlProvenance" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "campaignStatus" TEXT NOT NULL,
    "advertisingChannelType" TEXT,
    "adGroupId" TEXT,
    "adGroupName" TEXT,
    "adGroupStatus" TEXT,
    "adId" TEXT,
    "adStatus" TEXT,
    "adPrimaryStatus" TEXT,
    "adType" TEXT,
    "assetGroupId" TEXT,
    "assetGroupName" TEXT,
    "assetGroupStatus" TEXT,
    "assetGroupPrimaryStatus" TEXT,
    "landingPageSource" TEXT,
    "sourceActive" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncGeneration" BIGINT NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsDestinationReference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleAdsSyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "GoogleAdsSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "destinationsSeen" INTEGER NOT NULL DEFAULT 0,
    "enabledReferences" INTEGER NOT NULL DEFAULT 0,
    "uniqueDestinations" INTEGER NOT NULL DEFAULT 0,
    "matchedWebsites" INTEGER NOT NULL DEFAULT 0,
    "needsApproval" INTEGER NOT NULL DEFAULT 0,
    "unsupportedUrls" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdDestinationConfig" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "destinationTargetId" TEXT NOT NULL,
    "userPaused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdDestinationConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAdsConnection_organizationId_key" ON "GoogleAdsConnection"("organizationId");
CREATE INDEX "GoogleAdsConnection_status_idx" ON "GoogleAdsConnection"("status");

CREATE UNIQUE INDEX "GoogleAdsOAuthState_stateHash_key" ON "GoogleAdsOAuthState"("stateHash");
CREATE INDEX "GoogleAdsOAuthState_organizationId_idx" ON "GoogleAdsOAuthState"("organizationId");
CREATE INDEX "GoogleAdsOAuthState_userId_idx" ON "GoogleAdsOAuthState"("userId");
CREATE INDEX "GoogleAdsOAuthState_expiresAt_idx" ON "GoogleAdsOAuthState"("expiresAt");

CREATE UNIQUE INDEX "GoogleAdsCustomer_connectionId_googleCustomerId_key" ON "GoogleAdsCustomer"("connectionId", "googleCustomerId");
CREATE INDEX "GoogleAdsCustomer_organizationId_idx" ON "GoogleAdsCustomer"("organizationId");
CREATE INDEX "GoogleAdsCustomer_connectionId_idx" ON "GoogleAdsCustomer"("connectionId");
CREATE INDEX "GoogleAdsCustomer_status_selected_lastSyncedAt_idx" ON "GoogleAdsCustomer"("status", "selected", "lastSyncedAt");

CREATE UNIQUE INDEX "GoogleAdsDestinationTarget_monitorId_key" ON "GoogleAdsDestinationTarget"("monitorId");
CREATE UNIQUE INDEX "GoogleAdsDestinationTarget_googleAdsCustomerId_normalizedUrl_key" ON "GoogleAdsDestinationTarget"("googleAdsCustomerId", "normalizedUrl");
CREATE INDEX "GoogleAdsDestinationTarget_organizationId_idx" ON "GoogleAdsDestinationTarget"("organizationId");
CREATE INDEX "GoogleAdsDestinationTarget_googleAdsCustomerId_idx" ON "GoogleAdsDestinationTarget"("googleAdsCustomerId");
CREATE INDEX "GoogleAdsDestinationTarget_normalizedUrl_idx" ON "GoogleAdsDestinationTarget"("normalizedUrl");
CREATE INDEX "GoogleAdsDestinationTarget_hasActiveSource_idx" ON "GoogleAdsDestinationTarget"("hasActiveSource");
CREATE INDEX "GoogleAdsDestinationTarget_approvalStatus_idx" ON "GoogleAdsDestinationTarget"("approvalStatus");
CREATE INDEX "GoogleAdsDestinationTarget_websiteId_idx" ON "GoogleAdsDestinationTarget"("websiteId");

CREATE UNIQUE INDEX "GoogleAdsDestinationReference_targetId_sourceType_sourceEntityKey_key" ON "GoogleAdsDestinationReference"("targetId", "sourceType", "sourceEntityKey");
CREATE INDEX "GoogleAdsDestinationReference_targetId_idx" ON "GoogleAdsDestinationReference"("targetId");
CREATE INDEX "GoogleAdsDestinationReference_googleAdsCustomerId_idx" ON "GoogleAdsDestinationReference"("googleAdsCustomerId");
CREATE INDEX "GoogleAdsDestinationReference_sourceActive_idx" ON "GoogleAdsDestinationReference"("sourceActive");
CREATE INDEX "GoogleAdsDestinationReference_campaignId_idx" ON "GoogleAdsDestinationReference"("campaignId");
CREATE INDEX "GoogleAdsDestinationReference_lastSyncGeneration_idx" ON "GoogleAdsDestinationReference"("lastSyncGeneration");

CREATE INDEX "GoogleAdsSyncRun_customerId_startedAt_idx" ON "GoogleAdsSyncRun"("customerId", "startedAt");
CREATE INDEX "GoogleAdsSyncRun_organizationId_idx" ON "GoogleAdsSyncRun"("organizationId");
CREATE INDEX "GoogleAdsSyncRun_status_idx" ON "GoogleAdsSyncRun"("status");

CREATE UNIQUE INDEX "AdDestinationConfig_monitorId_key" ON "AdDestinationConfig"("monitorId");
CREATE UNIQUE INDEX "AdDestinationConfig_destinationTargetId_key" ON "AdDestinationConfig"("destinationTargetId");

ALTER TABLE "GoogleAdsConnection" ADD CONSTRAINT "GoogleAdsConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsOAuthState" ADD CONSTRAINT "GoogleAdsOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsCustomer" ADD CONSTRAINT "GoogleAdsCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsCustomer" ADD CONSTRAINT "GoogleAdsCustomer_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleAdsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsDestinationTarget" ADD CONSTRAINT "GoogleAdsDestinationTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsDestinationTarget" ADD CONSTRAINT "GoogleAdsDestinationTarget_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsDestinationTarget" ADD CONSTRAINT "GoogleAdsDestinationTarget_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsDestinationTarget" ADD CONSTRAINT "GoogleAdsDestinationTarget_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsDestinationReference" ADD CONSTRAINT "GoogleAdsDestinationReference_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "GoogleAdsDestinationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsDestinationReference" ADD CONSTRAINT "GoogleAdsDestinationReference_googleAdsCustomerId_fkey" FOREIGN KEY ("googleAdsCustomerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsSyncRun" ADD CONSTRAINT "GoogleAdsSyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleAdsSyncRun" ADD CONSTRAINT "GoogleAdsSyncRun_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "GoogleAdsCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdDestinationConfig" ADD CONSTRAINT "AdDestinationConfig_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdDestinationConfig" ADD CONSTRAINT "AdDestinationConfig_destinationTargetId_fkey" FOREIGN KEY ("destinationTargetId") REFERENCES "GoogleAdsDestinationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
