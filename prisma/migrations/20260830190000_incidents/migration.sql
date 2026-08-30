-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Monitor"
  ADD COLUMN "consecutiveFailuresBeforeIncident" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Monitor"
  ADD CONSTRAINT "Monitor_threshold_check"
  CHECK ("consecutiveFailuresBeforeIncident" >= 1 AND "consecutiveFailuresBeforeIncident" <= 10);

-- Existing consecutiveFailures from phase 4 are not reconstructed into incidents.
UPDATE "Monitor" SET "consecutiveFailures" = 0;

-- AlterTable
ALTER TABLE "MonitorCheck"
  ADD COLUMN "incidentProcessedAt" TIMESTAMP(3);

CREATE INDEX "MonitorCheck_monitorId_finishedAt_idx" ON "MonitorCheck"("monitorId", "finishedAt");

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "initialErrorType" "MonitorCheckErrorType",
    "latestErrorType" "MonitorCheckErrorType",
    "initialHttpStatus" INTEGER,
    "latestHttpStatus" INTEGER,
    "firstFailedCheckId" TEXT,
    "lastFailedCheckId" TEXT,
    "recoveryCheckId" TEXT,
    "failureCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Incident_monitorId_status_idx" ON "Incident"("monitorId", "status");
CREATE INDEX "Incident_status_detectedAt_idx" ON "Incident"("status", "detectedAt");
CREATE INDEX "Incident_detectedAt_idx" ON "Incident"("detectedAt");
CREATE INDEX "Incident_resolvedAt_idx" ON "Incident"("resolvedAt");
CREATE INDEX "Incident_startedAt_idx" ON "Incident"("startedAt");

-- One OPEN incident per monitor.
CREATE UNIQUE INDEX "Incident_monitorId_open_key"
  ON "Incident"("monitorId")
  WHERE "status" = 'OPEN';

ALTER TABLE "Incident"
  ADD CONSTRAINT "Incident_resolved_consistency"
  CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "recoveryCheckId" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL)
  );

ALTER TABLE "Incident"
  ADD CONSTRAINT "Incident_failureCount_check"
  CHECK ("failureCount" >= 1);

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_monitorId_fkey"
  FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_firstFailedCheckId_fkey"
  FOREIGN KEY ("firstFailedCheckId") REFERENCES "MonitorCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_lastFailedCheckId_fkey"
  FOREIGN KEY ("lastFailedCheckId") REFERENCES "MonitorCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_recoveryCheckId_fkey"
  FOREIGN KEY ("recoveryCheckId") REFERENCES "MonitorCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
