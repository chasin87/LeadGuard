-- AlterEnum
ALTER TYPE "MonitorCheckErrorType" ADD VALUE 'SOFT_404';

-- AlterTable
ALTER TABLE "MonitorCheck" ADD COLUMN "soft404Score" INTEGER;
ALTER TABLE "MonitorCheck" ADD COLUMN "soft404ClassifierVersion" TEXT;
ALTER TABLE "MonitorCheck" ADD COLUMN "soft404Signals" JSONB;
