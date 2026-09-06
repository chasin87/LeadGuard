import { getMonitorQueue } from "@/jobs/queue";
import {
  googleAdsAnalyticsBackfillQueue,
  googleAdsAnalyticsSyncQueue,
  googleAdsClickAttributionQueue,
  googleAdsImpactQueue,
  googleAdsSyncQueue,
  getGoogleAdsConfig,
} from "@/server/google-ads/config";
import {
  getGoogleDataManagerConfig,
  googleConversionPlanQueue,
  googleConversionStatusQueue,
  googleConversionSubmitQueue,
} from "@/server/google-data-manager/config";
import type {
  GoogleAdsAnalyticsSyncJobData,
  GoogleAdsClickResolutionJobData,
  GoogleAdsImpactJobData,
  GoogleAdsSyncJobData,
  GoogleConversionExportJobData,
  GoogleConversionPlanJobData,
} from "@/jobs/queue";
import {
  processGoogleAdsAnalyticsSyncJob,
  processGoogleAdsClickResolutionJob,
  processGoogleAdsImpactJob,
  processGoogleAdsSyncJob,
  processGoogleConversionPlanJob,
  processGoogleConversionStatusJob,
  processGoogleConversionSubmitJob,
} from "@/workers/google-ads-worker";
import { disconnectGoogleAdsSyncLocks } from "@/server/google-ads/sync";
import { disconnectGoogleAdsImpactLocks } from "@/server/google-ads/impact/refresh";
import { disconnectGoogleConversionLocks } from "@/server/google-ads/conversion-export";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { recordWorkerHeartbeat } from "@/server/ops/heartbeat";
import { stopMonitorQueue } from "@/jobs/queue";

const logger = createLogger("google-ads-worker");

async function main() {
  const queue = await getMonitorQueue();
  await queue.work<GoogleAdsSyncJobData>(
    googleAdsSyncQueue,
    { localConcurrency: 2, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleAdsSyncJob(job.data);
    },
  );
  await queue.work<GoogleAdsImpactJobData>(
    googleAdsImpactQueue,
    { localConcurrency: 1, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleAdsImpactJob(job.data);
    },
  );
  const conversionConfig = getGoogleDataManagerConfig();
  await queue.work<GoogleConversionPlanJobData>(
    googleConversionPlanQueue,
    { localConcurrency: 2, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleConversionPlanJob(job.data);
    },
  );
  await queue.work<GoogleConversionExportJobData>(
    googleConversionSubmitQueue,
    { localConcurrency: conversionConfig.workerConcurrency, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleConversionSubmitJob(job.data);
    },
  );
  await queue.work<GoogleConversionExportJobData>(
    googleConversionStatusQueue,
    { localConcurrency: conversionConfig.workerConcurrency, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleConversionStatusJob(job.data);
    },
  );
  const analyticsConcurrency = getGoogleAdsConfig().analyticsWorkerConcurrency;
  await queue.work<GoogleAdsAnalyticsSyncJobData>(
    googleAdsAnalyticsSyncQueue,
    { localConcurrency: analyticsConcurrency, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleAdsAnalyticsSyncJob(job.data);
    },
  );
  await queue.work<GoogleAdsAnalyticsSyncJobData>(
    googleAdsAnalyticsBackfillQueue,
    { localConcurrency: analyticsConcurrency, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleAdsAnalyticsSyncJob(job.data);
    },
  );
  await queue.work<GoogleAdsClickResolutionJobData>(
    googleAdsClickAttributionQueue,
    { localConcurrency: 2, batchSize: 1 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processGoogleAdsClickResolutionJob(job.data);
    },
  );
  logger.info("google_ads.worker.listening", {
    queue: googleAdsSyncQueue,
    impactQueue: googleAdsImpactQueue,
    conversionPlanQueue: googleConversionPlanQueue,
    conversionSubmitQueue: googleConversionSubmitQueue,
    conversionStatusQueue: googleConversionStatusQueue,
    analyticsSyncQueue: googleAdsAnalyticsSyncQueue,
    analyticsBackfillQueue: googleAdsAnalyticsBackfillQueue,
    clickAttributionQueue: googleAdsClickAttributionQueue,
  });
  await recordWorkerHeartbeat("GOOGLE_ADS");
}

async function shutdown(signal: string) {
  logger.info("google_ads.worker.shutdown", { signal });
  await stopMonitorQueue();
  await disconnectGoogleAdsSyncLocks();
  await disconnectGoogleAdsImpactLocks();
  await disconnectGoogleConversionLocks();
  await database.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

void main().catch((error: unknown) => {
  logger.error("google_ads.worker.crash", {
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exit(1);
});
