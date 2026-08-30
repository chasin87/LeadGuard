import { createLogger } from "@/server/logger";
import { executeGoogleAdsSyncJob } from "@/server/google-ads/sync";
import { executeGoogleAdsImpactJob } from "@/server/google-ads/impact/refresh";
import type {
  GoogleAdsImpactJobData,
  GoogleAdsSyncJobData,
} from "@/jobs/queue";

const logger = createLogger("google-ads-worker");

export async function processGoogleAdsSyncJob(data: GoogleAdsSyncJobData) {
  logger.info("google_ads.worker.started", {
    connectionId: data.connectionId,
    customerId: data.googleAdsCustomerId,
  });
  const outcome = await executeGoogleAdsSyncJob({
    connectionId: data.connectionId,
    googleAdsCustomerId: data.googleAdsCustomerId,
  });
  logger.info("google_ads.worker.finished", {
    connectionId: data.connectionId,
    customerId: data.googleAdsCustomerId,
    outcome,
  });
  return outcome;
}

export async function processGoogleAdsImpactJob(data: GoogleAdsImpactJobData) {
  logger.info("google_ads.impact.worker.started", {
    incidentId: data.incidentId,
    reason: data.reason,
  });
  const outcome = await executeGoogleAdsImpactJob(data);
  logger.info("google_ads.impact.worker.finished", {
    incidentId: data.incidentId,
    reason: data.reason,
    outcome: String(outcome),
  });
  return outcome;
}
