-- AlterEnum
ALTER TYPE "MonitorType" ADD VALUE 'BROWSER';

-- AlterEnum
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'BROWSER_NAVIGATION_ERROR';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'BROWSER_TIMEOUT';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'BROWSER_CRASH';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'PAGE_CRASH';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'JAVASCRIPT_ERROR';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'REQUIRED_ELEMENT_MISSING';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'CONTENT_NOT_RENDERED';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'UNSAFE_BROWSER_REQUEST';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'TOO_MANY_BROWSER_ERRORS';
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'INVALID_MONITOR_CONFIGURATION';

-- CreateEnum
CREATE TYPE "BrowserViewport" AS ENUM ('DESKTOP', 'MOBILE');

-- HTTP and Browser monitors may share the same URL on one website.
DROP INDEX "Monitor_websiteId_normalizedUrl_active_key";

CREATE UNIQUE INDEX "Monitor_websiteId_type_normalizedUrl_active_key"
  ON "Monitor"("websiteId", "type", "normalizedUrl")
  WHERE "deletedAt" IS NULL;

-- CreateTable
CREATE TABLE "BrowserMonitorConfig" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "viewport" "BrowserViewport" NOT NULL DEFAULT 'DESKTOP',
    "requiredSelector" TEXT,
    "requiredElementName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserMonitorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserCheckDetail" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "viewport" "BrowserViewport" NOT NULL,
    "navigationDurationMs" INTEGER,
    "totalDurationMs" INTEGER,
    "javascriptErrorCount" INTEGER NOT NULL DEFAULT 0,
    "pageErrorCount" INTEGER NOT NULL DEFAULT 0,
    "failedResourceCount" INTEGER NOT NULL DEFAULT 0,
    "requiredElementFound" BOOLEAN,
    "renderedTextLength" INTEGER,
    "screenshotKey" TEXT,
    "screenshotCapturedAt" TIMESTAMP(3),
    "javascriptErrors" JSONB,
    "failedResources" JSONB,
    "dialogOccurred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserCheckDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserMonitorConfig_monitorId_key" ON "BrowserMonitorConfig"("monitorId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserCheckDetail_checkId_key" ON "BrowserCheckDetail"("checkId");

-- CreateIndex
CREATE INDEX "BrowserCheckDetail_screenshotCapturedAt_idx" ON "BrowserCheckDetail"("screenshotCapturedAt");

-- AddForeignKey
ALTER TABLE "BrowserMonitorConfig" ADD CONSTRAINT "BrowserMonitorConfig_monitorId_fkey"
  FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserCheckDetail" ADD CONSTRAINT "BrowserCheckDetail_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "MonitorCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
