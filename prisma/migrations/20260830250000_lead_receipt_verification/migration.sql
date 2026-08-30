-- AlterEnum
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'LEAD_RECEIPT_TIMEOUT';

-- AlterEnum
ALTER TYPE "FormFieldRole" ADD VALUE 'LEADGUARD_SUBMISSION_ID';

-- CreateEnum
CREATE TYPE "LeadReceiptMode" AS ENUM ('NONE', 'INBOUND_EMAIL', 'RECEIPT_WEBHOOK');
CREATE TYPE "LeadReceiptStatus" AS ENUM ('PENDING', 'RECEIVED', 'TIMED_OUT', 'FAILED');
CREATE TYPE "LeadReceiptMethod" AS ENUM ('INBOUND_EMAIL', 'WEBHOOK');

-- AlterTable
ALTER TABLE "FormMonitorConfig" ADD COLUMN "receiptMode" "LeadReceiptMode" NOT NULL DEFAULT 'NONE';
ALTER TABLE "FormMonitorConfig" ADD COLUMN "receiptTimeoutMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "FormMonitorConfig" ADD COLUMN "receiptWebhookSecretHash" TEXT;
ALTER TABLE "FormMonitorConfig" ADD COLUMN "receiptWebhookSecretPrefix" TEXT;
ALTER TABLE "FormMonitorConfig" ADD COLUMN "receiptVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "FormMonitorConfig_receiptWebhookSecretHash_key" ON "FormMonitorConfig"("receiptWebhookSecretHash");

-- CreateTable
CREATE TABLE "LeadReceiptVerification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "monitorCheckId" TEXT NOT NULL,
    "submissionAttemptId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "method" "LeadReceiptMethod" NOT NULL,
    "status" "LeadReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "expectedAt" TIMESTAMP(3) NOT NULL,
    "timeoutAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "receiptLatencyMs" INTEGER,
    "lateReceipt" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" "LeadReceiptMethod",
    "providerMessageId" TEXT,
    "senderDomain" TEXT,
    "subjectPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadReceiptVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadReceiptVerification_monitorCheckId_key" ON "LeadReceiptVerification"("monitorCheckId");
CREATE UNIQUE INDEX "LeadReceiptVerification_submissionAttemptId_key" ON "LeadReceiptVerification"("submissionAttemptId");
CREATE UNIQUE INDEX "LeadReceiptVerification_submissionId_key" ON "LeadReceiptVerification"("submissionId");
CREATE INDEX "LeadReceiptVerification_organizationId_idx" ON "LeadReceiptVerification"("organizationId");
CREATE INDEX "LeadReceiptVerification_monitorId_status_idx" ON "LeadReceiptVerification"("monitorId", "status");
CREATE INDEX "LeadReceiptVerification_status_timeoutAt_idx" ON "LeadReceiptVerification"("status", "timeoutAt");

ALTER TABLE "LeadReceiptVerification" ADD CONSTRAINT "LeadReceiptVerification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadReceiptVerification" ADD CONSTRAINT "LeadReceiptVerification_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadReceiptVerification" ADD CONSTRAINT "LeadReceiptVerification_monitorCheckId_fkey" FOREIGN KEY ("monitorCheckId") REFERENCES "MonitorCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadReceiptVerification" ADD CONSTRAINT "LeadReceiptVerification_submissionAttemptId_fkey" FOREIGN KEY ("submissionAttemptId") REFERENCES "FormSubmissionAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FormSubmissionAttempt_submissionId_idx" ON "FormSubmissionAttempt"("submissionId");

CREATE TABLE "InboundEmailMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "submissionId" TEXT,
    "recipient" TEXT,
    "senderDomain" TEXT,
    "subjectPreview" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundEmailMessage_provider_providerMessageId_key" ON "InboundEmailMessage"("provider", "providerMessageId");
CREATE INDEX "InboundEmailMessage_submissionId_idx" ON "InboundEmailMessage"("submissionId");
CREATE INDEX "InboundEmailMessage_organizationId_idx" ON "InboundEmailMessage"("organizationId");

ALTER TABLE "InboundEmailMessage" ADD CONSTRAINT "InboundEmailMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
