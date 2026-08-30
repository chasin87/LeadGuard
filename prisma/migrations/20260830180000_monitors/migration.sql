-- CreateEnum
CREATE TYPE "MonitorType" AS ENUM ('HTTP');

-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "MonitorCheckStatus" AS ENUM ('SUCCESS', 'DEGRADED', 'FAILURE');

-- CreateEnum
CREATE TYPE "MonitorCheckErrorType" AS ENUM (
  'HTTP_4XX',
  'HTTP_404',
  'HTTP_401',
  'HTTP_403',
  'HTTP_429',
  'HTTP_5XX',
  'TIMEOUT',
  'DNS_ERROR',
  'SSL_ERROR',
  'CONNECTION_ERROR',
  'REDIRECT_LOOP',
  'TOO_MANY_REDIRECTS',
  'UNSAFE_REDIRECT',
  'UNSAFE_TARGET',
  'INVALID_RESPONSE',
  'UNKNOWN'
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MonitorType" NOT NULL DEFAULT 'HTTP',
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "status" "MonitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "intervalSeconds" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCheck" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "jobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "status" "MonitorCheckStatus" NOT NULL,
    "httpStatus" INTEGER,
    "responseTimeMs" INTEGER,
    "requestedUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "redirectCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedIp" TEXT,
    "errorType" "MonitorCheckErrorType",
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Monitor_websiteId_idx" ON "Monitor"("websiteId");

-- CreateIndex
CREATE INDEX "Monitor_status_nextCheckAt_idx" ON "Monitor"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "Monitor_nextCheckAt_idx" ON "Monitor"("nextCheckAt");

-- Partial unique: a website may re-add a URL after soft-delete.
CREATE UNIQUE INDEX "Monitor_websiteId_normalizedUrl_active_key"
  ON "Monitor"("websiteId", "normalizedUrl")
  WHERE "deletedAt" IS NULL;

-- Scheduler due-query: skip deleted rows without a full table scan pattern.
CREATE INDEX "Monitor_due_idx"
  ON "Monitor"("status", "nextCheckAt")
  WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "MonitorCheck_monitorId_createdAt_idx" ON "MonitorCheck"("monitorId", "createdAt");

-- CreateIndex
CREATE INDEX "MonitorCheck_createdAt_idx" ON "MonitorCheck"("createdAt");

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorCheck" ADD CONSTRAINT "MonitorCheck_monitorId_fkey"
  FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
