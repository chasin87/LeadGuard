import { createLogger } from "@/server/logger";
import { executeGoogleAdsSyncJob } from "@/server/google-ads/sync";
import { executeGoogleAdsImpactJob } from "@/server/google-ads/impact/refresh";
import {
  planGoogleConversionExport,
  pollGoogleConversionExportStatus,
  submitGoogleConversionExport,
} from "@/server/google-ads/conversion-export";
import {
  enqueueGoogleConversionStatus,
  enqueueGoogleConversionSubmit,
} from "@/jobs/queue";
import { executeGoogleAdsAnalyticsSync } from "@/server/google-ads/analytics-sync";
import { executeGoogleAdsClickResolution } from "@/server/google-ads/click-resolution";
import type {
  GoogleAdsAnalyticsSyncJobData,
  GoogleAdsClickResolutionJobData,
  GoogleAdsImpactJobData,
  GoogleAdsSyncJobData,
  GoogleConversionExportJobData,
  GoogleConversionPlanJobData,
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

export async function processGoogleConversionPlanJob(
  data: GoogleConversionPlanJobData,
) {
  logger.info("google_conversion.plan.started", {
    leadId: data.leadId,
    organizationId: data.organizationId,
  });
  const result = await planGoogleConversionExport({
    leadId: data.leadId,
    organizationId: data.organizationId,
    enqueueSubmit: (exportId) => enqueueGoogleConversionSubmit(exportId),
  });
  logger.info("google_conversion.plan.finished", {
    leadId: data.leadId,
    exportId: result?.id ?? null,
    status: result?.status ?? null,
  });
  return result;
}

export async function processGoogleConversionSubmitJob(
  data: GoogleConversionExportJobData,
) {
  logger.info("google_conversion.submit.started", { exportId: data.exportId });
  const result = await submitGoogleConversionExport({
    exportId: data.exportId,
    enqueueStatus: (exportId, delaySeconds) =>
      enqueueGoogleConversionStatus(exportId, delaySeconds),
  });
  logger.info("google_conversion.submit.finished", {
    exportId: data.exportId,
    status:
      result && typeof result === "object" ? result.status : String(result),
  });
  return result;
}

export async function processGoogleConversionStatusJob(
  data: GoogleConversionExportJobData,
) {
  logger.info("google_conversion.status.started", { exportId: data.exportId });
  const result = await pollGoogleConversionExportStatus({
    exportId: data.exportId,
    enqueueStatus: (exportId, delaySeconds) =>
      enqueueGoogleConversionStatus(exportId, delaySeconds),
  });
  logger.info("google_conversion.status.finished", {
    exportId: data.exportId,
    status:
      result && typeof result === "object" ? result.status : String(result),
  });
  return result;
}

export async function processGoogleAdsAnalyticsSyncJob(
  data: GoogleAdsAnalyticsSyncJobData,
) {
  logger.info("google_ads.analytics.worker.started", {
    customerId: data.googleAdsCustomerId,
    kind: data.kind,
  });
  const outcome = await executeGoogleAdsAnalyticsSync(data);
  logger.info("google_ads.analytics.worker.finished", {
    customerId: data.googleAdsCustomerId,
    kind: data.kind,
    outcome,
  });
  return outcome;
}

export async function processGoogleAdsClickResolutionJob(
  data: GoogleAdsClickResolutionJobData,
) {
  logger.info("google_ads.attribution.worker.started", {
    customerId: data.googleAdsCustomerId,
    leadId: data.leadId ?? null,
  });
  const outcome = await executeGoogleAdsClickResolution(data);
  logger.info("google_ads.attribution.worker.finished", {
    customerId: data.googleAdsCustomerId,
    resolved: outcome.resolved,
  });
  return outcome;
}
