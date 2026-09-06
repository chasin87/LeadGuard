-- CreateEnum
CREATE TYPE "TrackingConfigStatus" AS ENUM ('DISABLED', 'ENABLED');
CREATE TYPE "TrackingConsentMode" AS ENUM ('REQUIRED', 'EXTERNAL');
CREATE TYPE "AttributionChannel" AS ENUM ('GOOGLE_ADS', 'OTHER_PAID', 'ORGANIC', 'DIRECT', 'UNKNOWN');
CREATE TYPE "LeadSource" AS ENUM ('BROWSER_SDK', 'SERVER_API');
CREATE TYPE "LeadAttributionModel" AS ENUM ('LAST_ELIGIBLE_PAID_TOUCH');
CREATE TYPE "LeadAttributionStatus" AS ENUM ('PENDING_ATTRIBUTION', 'ATTRIBUTED', 'ORGANIC_OR_DIRECT', 'UNATTRIBUTED', 'EXPIRED', 'DELETED');
CREATE TYPE "TrackingIngestionType" AS ENUM ('SESSION_STARTED', 'ATTRIBUTION_CAPTURED', 'LEAD_CREATED');
CREATE TYPE "TrackingIngestionStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED');

-- CreateTable
CREATE TABLE "WebsiteTrackingConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "status" "TrackingConfigStatus" NOT NULL DEFAULT 'DISABLED',
    "consentMode" "TrackingConsentMode" NOT NULL DEFAULT 'REQUIRED',
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 90,
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "publicSiteKeyHash" TEXT NOT NULL,
    "publicSiteKey" TEXT NOT NULL,
    "previousPublicSiteKeyHash" TEXT,
    "previousSiteKeyExpiresAt" TIMESTAMP(3),
    "serverIngestionSecretHash" TEXT,
    "lastEventReceivedAt" TIMESTAMP(3),
    "lastAttributionReceivedAt" TIMESTAMP(3),
    "lastLeadReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteTrackingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributionVisitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "publicVisitorId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributionVisitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributionSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "publicSessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "landingOrigin" TEXT,
    "landingPath" TEXT,
    "referrerDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributionSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributionTouch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "channel" "AttributionChannel" NOT NULL,
    "encryptedGclid" TEXT,
    "encryptedGbraid" TEXT,
    "encryptedWbraid" TEXT,
    "gclidHash" TEXT,
    "gbraidHash" TEXT,
    "wbraidHash" TEXT,
    "hasGclid" BOOLEAN NOT NULL DEFAULT false,
    "hasGbraid" BOOLEAN NOT NULL DEFAULT false,
    "hasWbraid" BOOLEAN NOT NULL DEFAULT false,
    "landingOrigin" TEXT,
    "landingPath" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributionTouch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributionToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "publicLeadId" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT NOT NULL,
    "externalLeadId" TEXT,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadAttribution" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "firstTouchId" TEXT,
    "primaryTouchId" TEXT,
    "attributionModel" "LeadAttributionModel" NOT NULL DEFAULT 'LAST_ELIGIBLE_PAID_TOUCH',
    "attributionStatus" "LeadAttributionStatus" NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackingIngestionEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "TrackingIngestionType" NOT NULL,
    "status" "TrackingIngestionStatus" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingIngestionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteTrackingConfig_websiteId_key" ON "WebsiteTrackingConfig"("websiteId");
CREATE UNIQUE INDEX "WebsiteTrackingConfig_publicSiteKeyHash_key" ON "WebsiteTrackingConfig"("publicSiteKeyHash");
CREATE UNIQUE INDEX "WebsiteTrackingConfig_serverIngestionSecretHash_key" ON "WebsiteTrackingConfig"("serverIngestionSecretHash");
CREATE INDEX "WebsiteTrackingConfig_organizationId_idx" ON "WebsiteTrackingConfig"("organizationId");
CREATE INDEX "WebsiteTrackingConfig_status_idx" ON "WebsiteTrackingConfig"("status");
CREATE INDEX "WebsiteTrackingConfig_previousPublicSiteKeyHash_idx" ON "WebsiteTrackingConfig"("previousPublicSiteKeyHash");

CREATE UNIQUE INDEX "AttributionVisitor_websiteId_publicVisitorId_key" ON "AttributionVisitor"("websiteId", "publicVisitorId");
CREATE INDEX "AttributionVisitor_organizationId_idx" ON "AttributionVisitor"("organizationId");
CREATE INDEX "AttributionVisitor_expiresAt_idx" ON "AttributionVisitor"("expiresAt");
CREATE INDEX "AttributionVisitor_websiteId_lastSeenAt_idx" ON "AttributionVisitor"("websiteId", "lastSeenAt");

CREATE UNIQUE INDEX "AttributionSession_websiteId_publicSessionId_key" ON "AttributionSession"("websiteId", "publicSessionId");
CREATE INDEX "AttributionSession_visitorId_publicSessionId_idx" ON "AttributionSession"("visitorId", "publicSessionId");
CREATE INDEX "AttributionSession_lastSeenAt_idx" ON "AttributionSession"("lastSeenAt");
CREATE INDEX "AttributionSession_organizationId_idx" ON "AttributionSession"("organizationId");

CREATE INDEX "AttributionTouch_visitorId_capturedAt_idx" ON "AttributionTouch"("visitorId", "capturedAt");
CREATE INDEX "AttributionTouch_websiteId_capturedAt_idx" ON "AttributionTouch"("websiteId", "capturedAt");
CREATE INDEX "AttributionTouch_expiresAt_idx" ON "AttributionTouch"("expiresAt");
CREATE INDEX "AttributionTouch_organizationId_idx" ON "AttributionTouch"("organizationId");
CREATE INDEX "AttributionTouch_gclidHash_idx" ON "AttributionTouch"("gclidHash");
CREATE INDEX "AttributionTouch_gbraidHash_idx" ON "AttributionTouch"("gbraidHash");
CREATE INDEX "AttributionTouch_wbraidHash_idx" ON "AttributionTouch"("wbraidHash");

CREATE UNIQUE INDEX "AttributionToken_tokenHash_key" ON "AttributionToken"("tokenHash");
CREATE INDEX "AttributionToken_expiresAt_idx" ON "AttributionToken"("expiresAt");
CREATE INDEX "AttributionToken_websiteId_idx" ON "AttributionToken"("websiteId");
CREATE INDEX "AttributionToken_organizationId_idx" ON "AttributionToken"("organizationId");

CREATE UNIQUE INDEX "Lead_publicLeadId_key" ON "Lead"("publicLeadId");
CREATE UNIQUE INDEX "Lead_websiteId_eventId_key" ON "Lead"("websiteId", "eventId");
CREATE UNIQUE INDEX "Lead_websiteId_source_externalLeadId_key" ON "Lead"("websiteId", "source", "externalLeadId");
CREATE INDEX "Lead_organizationId_occurredAt_idx" ON "Lead"("organizationId", "occurredAt");
CREATE INDEX "Lead_websiteId_occurredAt_idx" ON "Lead"("websiteId", "occurredAt");

CREATE UNIQUE INDEX "LeadAttribution_leadId_key" ON "LeadAttribution"("leadId");
CREATE INDEX "LeadAttribution_organizationId_idx" ON "LeadAttribution"("organizationId");
CREATE INDEX "LeadAttribution_websiteId_idx" ON "LeadAttribution"("websiteId");
CREATE INDEX "LeadAttribution_attributionStatus_finalizedAt_idx" ON "LeadAttribution"("attributionStatus", "finalizedAt");

CREATE UNIQUE INDEX "TrackingIngestionEvent_websiteId_eventId_key" ON "TrackingIngestionEvent"("websiteId", "eventId");
CREATE INDEX "TrackingIngestionEvent_organizationId_idx" ON "TrackingIngestionEvent"("organizationId");
CREATE INDEX "TrackingIngestionEvent_receivedAt_idx" ON "TrackingIngestionEvent"("receivedAt");

ALTER TABLE "WebsiteTrackingConfig" ADD CONSTRAINT "WebsiteTrackingConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteTrackingConfig" ADD CONSTRAINT "WebsiteTrackingConfig_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttributionVisitor" ADD CONSTRAINT "AttributionVisitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionVisitor" ADD CONSTRAINT "AttributionVisitor_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttributionSession" ADD CONSTRAINT "AttributionSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionSession" ADD CONSTRAINT "AttributionSession_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionSession" ADD CONSTRAINT "AttributionSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AttributionVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AttributionVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttributionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttributionToken" ADD CONSTRAINT "AttributionToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionToken" ADD CONSTRAINT "AttributionToken_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionToken" ADD CONSTRAINT "AttributionToken_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AttributionVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionToken" ADD CONSTRAINT "AttributionToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttributionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AttributionVisitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttributionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AttributionVisitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttributionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_firstTouchId_fkey" FOREIGN KEY ("firstTouchId") REFERENCES "AttributionTouch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_primaryTouchId_fkey" FOREIGN KEY ("primaryTouchId") REFERENCES "AttributionTouch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrackingIngestionEvent" ADD CONSTRAINT "TrackingIngestionEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingIngestionEvent" ADD CONSTRAINT "TrackingIngestionEvent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
