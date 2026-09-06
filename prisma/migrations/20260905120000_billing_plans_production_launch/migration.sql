-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('STRIPE', 'FAKE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "BillingPlanKey" AS ENUM ('STARTER', 'GROWTH', 'PRO', 'AGENCY', 'LEGACY');

-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED', 'SUSPENDED', 'INCOMPLETE', 'TRIAL_EXPIRED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "BillingProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingCheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkerHeartbeatType" AS ENUM ('WEB', 'SCHEDULER', 'HTTP', 'BROWSER', 'NOTIFICATION', 'GOOGLE_ADS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "trialConsumedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingCustomerId" TEXT,
    "provider" "BillingProvider" NOT NULL,
    "providerSubscriptionId" TEXT NOT NULL,
    "planKey" "BillingPlanKey" NOT NULL,
    "status" "BillingSubscriptionStatus" NOT NULL,
    "providerStatus" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "graceDeadlineAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "priceId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lastStripeEventAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "BillingProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "eventCreatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "organizationId" TEXT,

    CONSTRAINT "BillingProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCheckoutSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingCustomerId" TEXT,
    "planKey" "BillingPlanKey" NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "status" "BillingCheckoutSessionStatus" NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "planKey" TEXT,
    "providerEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationOnboarding" (
    "organizationId" TEXT NOT NULL,
    "websiteCompletedAt" TIMESTAMP(3),
    "monitorCompletedAt" TIMESTAMP(3),
    "notificationCompletedAt" TIMESTAMP(3),
    "firstCheckCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationOnboarding_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerType" "WorkerHeartbeatType" NOT NULL,
    "instanceId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_organizationId_key" ON "BillingCustomer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_providerCustomerId_key" ON "BillingCustomer"("providerCustomerId");

-- CreateIndex
CREATE INDEX "BillingCustomer_provider_providerCustomerId_idx" ON "BillingCustomer"("provider", "providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_organizationId_key" ON "BillingSubscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_providerSubscriptionId_key" ON "BillingSubscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingSubscription_status_currentPeriodEnd_idx" ON "BillingSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "BillingSubscription_provider_status_idx" ON "BillingSubscription"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProviderEvent_providerEventId_key" ON "BillingProviderEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "BillingProviderEvent_status_receivedAt_idx" ON "BillingProviderEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "BillingProviderEvent_type_receivedAt_idx" ON "BillingProviderEvent"("type", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckoutSession_providerSessionId_key" ON "BillingCheckoutSession"("providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckoutSession_idempotencyKey_key" ON "BillingCheckoutSession"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingCheckoutSession_organizationId_status_idx" ON "BillingCheckoutSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_organizationId_createdAt_idx" ON "BillingAuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_workerType_instanceId_key" ON "WorkerHeartbeat"("workerType", "instanceId");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_workerType_lastSeenAt_idx" ON "WorkerHeartbeat"("workerType", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "BillingCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCheckoutSession" ADD CONSTRAINT "BillingCheckoutSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCheckoutSession" ADD CONSTRAINT "BillingCheckoutSession_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "BillingCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAuditEvent" ADD CONSTRAINT "BillingAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationOnboarding" ADD CONSTRAINT "OrganizationOnboarding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grandfather existing organizations so Fase 18 deploy does not suspend them.
INSERT INTO "BillingSubscription" (
  "id",
  "organizationId",
  "provider",
  "providerSubscriptionId",
  "planKey",
  "status",
  "providerStatus",
  "currentPeriodStart",
  "currentPeriodEnd",
  "quantity",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy_' || o.id,
  o.id,
  'INTERNAL',
  'legacy:' || o.id,
  'LEGACY',
  'ACTIVE',
  'grandfathered',
  o."createdAt",
  TIMESTAMP '2099-12-31 23:59:59',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "BillingSubscription" s WHERE s."organizationId" = o.id
);
