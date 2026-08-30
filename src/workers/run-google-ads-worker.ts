import { getMonitorQueue } from "@/jobs/queue";
import {
  googleAdsImpactQueue,
  googleAdsSyncQueue,
} from "@/server/google-ads/config";
import type {
  GoogleAdsImpactJobData,
  GoogleAdsSyncJobData,
} from "@/jobs/queue";
import {
  processGoogleAdsImpactJob,
  processGoogleAdsSyncJob,
} from "@/workers/google-ads-worker";
import { disconnectGoogleAdsSyncLocks } from "@/server/google-ads/sync";
import { disconnectGoogleAdsImpactLocks } from "@/server/google-ads/impact/refresh";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
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
  logger.info("google_ads.worker.listening", {
    queue: googleAdsSyncQueue,
    impactQueue: googleAdsImpactQueue,
  });
}

async function shutdown(signal: string) {
  logger.info("google_ads.worker.shutdown", { signal });
  await stopMonitorQueue();
  await disconnectGoogleAdsSyncLocks();
  await disconnectGoogleAdsImpactLocks();
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
