-- AlterEnum
ALTER TYPE "MonitorType" ADD VALUE 'FORM';

-- AlterEnum
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_NOT_FOUND';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_FIELD_MISSING';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_FIELD_NOT_INTERACTABLE';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'SUBMIT_BUTTON_MISSING';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'SUBMIT_BUTTON_DISABLED';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_SUBMISSION_FAILED';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_SUBMISSION_TIMEOUT';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_VALIDATION_ERROR';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_SUCCESS_NOT_CONFIRMED';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_UNEXPECTED_NAVIGATION';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'UNSUPPORTED_CAPTCHA';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'UNMAPPED_REQUIRED_FIELD';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'FORM_OPTION_MISSING';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'AMBIGUOUS_SUBMISSION';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'UNSUPPORTED_FORM_TYPE';

-- CreateEnum
CREATE TYPE "FormConfigurationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'INVALID');
CREATE TYPE "FormSuccessMode" AS ENUM ('ANY', 'SELECTOR', 'URL', 'TEXT');
CREATE TYPE "FormSubmissionState" AS ENUM ('PREPARED', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'AMBIGUOUS');
CREATE TYPE "FormFieldRole" AS ENUM ('NAME', 'EMAIL', 'PHONE', 'POSTCODE', 'HOUSE_NUMBER', 'CITY', 'MESSAGE', 'COMPANY', 'CUSTOM');
CREATE TYPE "FormFieldControl" AS ENUM ('TEXT', 'EMAIL', 'TEL', 'TEXTAREA', 'SELECT', 'CHECKBOX', 'RADIO');

-- CreateTable
CREATE TABLE "FormTestProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "company" TEXT,
    "messagePrefix" TEXT,
    "plusAddressing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTestProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormMonitorConfig" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "viewport" "BrowserViewport" NOT NULL DEFAULT 'DESKTOP',
    "formSelector" TEXT NOT NULL,
    "submitSelector" TEXT NOT NULL,
    "cookieAcceptSelector" TEXT,
    "fieldMappings" JSONB NOT NULL,
    "successMode" "FormSuccessMode" NOT NULL DEFAULT 'ANY',
    "successSelector" TEXT,
    "successUrlPattern" TEXT,
    "successText" TEXT,
    "submissionTimeoutMs" INTEGER NOT NULL DEFAULT 20000,
    "testProfileId" TEXT,
    "configurationStatus" "FormConfigurationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationResult" JSONB,
    "consentedAt" TIMESTAMP(3),
    "consentedByUserId" TEXT,
    "consentVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormMonitorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmissionAttempt" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "state" "FormSubmissionState" NOT NULL DEFAULT 'PREPARED',
    "checkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormCheckDetail" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "submissionState" "FormSubmissionState" NOT NULL,
    "successConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "submissionDurationMs" INTEGER,
    "submitHttpStatus" INTEGER,
    "submitEndpointPath" TEXT,
    "submitMethod" TEXT,
    "fieldsExpectedCount" INTEGER NOT NULL DEFAULT 0,
    "fieldsFoundCount" INTEGER NOT NULL DEFAULT 0,
    "formFound" BOOLEAN NOT NULL DEFAULT false,
    "submitClicked" BOOLEAN NOT NULL DEFAULT false,
    "captchaDetected" BOOLEAN NOT NULL DEFAULT false,
    "validationErrors" JSONB,
    "unmappedRequiredFields" JSONB,
    "screenshotKey" TEXT,
    "screenshotCapturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormCheckDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormTestProfile_organizationId_name_key" ON "FormTestProfile"("organizationId", "name");
CREATE INDEX "FormTestProfile_organizationId_idx" ON "FormTestProfile"("organizationId");
CREATE UNIQUE INDEX "FormMonitorConfig_monitorId_key" ON "FormMonitorConfig"("monitorId");
CREATE INDEX "FormMonitorConfig_testProfileId_idx" ON "FormMonitorConfig"("testProfileId");
CREATE INDEX "FormMonitorConfig_configurationStatus_idx" ON "FormMonitorConfig"("configurationStatus");
CREATE UNIQUE INDEX "FormSubmissionAttempt_jobId_key" ON "FormSubmissionAttempt"("jobId");
CREATE UNIQUE INDEX "FormSubmissionAttempt_checkId_key" ON "FormSubmissionAttempt"("checkId");
CREATE INDEX "FormSubmissionAttempt_monitorId_createdAt_idx" ON "FormSubmissionAttempt"("monitorId", "createdAt");
CREATE INDEX "FormSubmissionAttempt_state_idx" ON "FormSubmissionAttempt"("state");
CREATE UNIQUE INDEX "FormCheckDetail_checkId_key" ON "FormCheckDetail"("checkId");
CREATE INDEX "FormCheckDetail_screenshotCapturedAt_idx" ON "FormCheckDetail"("screenshotCapturedAt");

-- AddForeignKey
ALTER TABLE "FormTestProfile" ADD CONSTRAINT "FormTestProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormMonitorConfig" ADD CONSTRAINT "FormMonitorConfig_monitorId_fkey"
  FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormMonitorConfig" ADD CONSTRAINT "FormMonitorConfig_testProfileId_fkey"
  FOREIGN KEY ("testProfileId") REFERENCES "FormTestProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FormMonitorConfig" ADD CONSTRAINT "FormMonitorConfig_consentedByUserId_fkey"
  FOREIGN KEY ("consentedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FormSubmissionAttempt" ADD CONSTRAINT "FormSubmissionAttempt_monitorId_fkey"
  FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormSubmissionAttempt" ADD CONSTRAINT "FormSubmissionAttempt_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "MonitorCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FormCheckDetail" ADD CONSTRAINT "FormCheckDetail_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "MonitorCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
