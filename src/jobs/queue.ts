import { PgBoss } from "pg-boss";
import { getServerEnvironment } from "@/lib/env";
import { createLogger } from "@/server/logger";
import {
  getMonitoringConfig,
  monitorCheckQueue,
} from "@/server/monitoring/config";
import {
  browserCheckQueue,
  getBrowserMonitoringConfig,
} from "@/server/monitoring/browser/config";
import {
  formCheckQueue,
  getFormMonitoringConfig,
} from "@/server/monitoring/form/config";
import { notificationDeliveryQueue } from "@/server/notifications/config";
import { outcomeImportQueue } from "@/server/outcomes/queue";
import {
  getGoogleAdsConfig,
  googleAdsAnalyticsBackfillQueue,
  googleAdsAnalyticsSyncQueue,
  googleAdsClickAttributionQueue,
  googleAdsImpactQueue,
  googleAdsSyncQueue,
} from "@/server/google-ads/config";
import {
  getGoogleDataManagerConfig,
  googleConversionPlanQueue,
  googleConversionStatusQueue,
  googleConversionSubmitQueue,
} from "@/server/google-data-manager/config";

const logger = createLogger("queue");

const globalQueue = globalThis as unknown as {
  monitorBoss?: Promise<PgBoss>;
  notificationBoss?: Promise<PgBoss>;
};

export type MonitorCheckJobData = {
  monitorId: string;
};

export type FormCheckJobData = {
  monitorId: string;
  mode: "submit" | "validate";
  source: "scheduler" | "manual";
};

export type NotificationDeliveryJobData = {
  deliveryId: string;
};

export type OutcomeImportJobData = {
  importId: string;
};

export type GoogleAdsSyncJobData = {
  connectionId: string;
  googleAdsCustomerId: string;
};

export type GoogleAdsImpactJobData = {
  incidentId: string;
  reason: "open" | "refresh" | "finalize" | "reconcile" | "manual";
};

export type GoogleConversionPlanJobData = {
  leadId: string;
  organizationId: string;
};

export type GoogleConversionExportJobData = {
  exportId: string;
};

export type GoogleAdsAnalyticsSyncJobData = {
  googleAdsCustomerId: string;
  organizationId: string;
  kind: "RECENT" | "BACKFILL" | "MANUAL";
  days?: number;
};

export type GoogleAdsClickResolutionJobData = {
  organizationId: string;
  googleAdsCustomerId: string;
  leadId?: string;
};

async function createMonitorQueue(): Promise<PgBoss> {
  const config = getMonitoringConfig();
  const boss = new PgBoss({
    connectionString: getServerEnvironment().DATABASE_URL,
    application_name: "leadguard-queue",
    max: 4,
  });
  boss.on("error", (error) => {
    logger.error("queue.error", { message: String(error) });
  });
  await boss.start();
  await boss.createQueue(monitorCheckQueue, {
    policy: "exclusive",
    retryLimit: config.jobRetryLimit,
    retryDelay: config.jobRetryDelaySeconds,
    expireInSeconds: 120,
  });
  const browserConfig = getBrowserMonitoringConfig();
  await boss.createQueue(browserCheckQueue, {
    policy: "exclusive",
    retryLimit: browserConfig.jobRetryLimit,
    retryDelay: browserConfig.jobRetryDelaySeconds,
    expireInSeconds: 180,
  });
  const formConfig = getFormMonitoringConfig();
  await boss.createQueue(formCheckQueue, {
    policy: "exclusive",
    retryLimit: formConfig.jobRetryLimit,
    retryDelay: formConfig.jobRetryDelaySeconds,
    expireInSeconds: formConfig.expireInSeconds,
  });
  const adsConfig = getGoogleAdsConfig();
  await boss.createQueue(googleAdsSyncQueue, {
    policy: "exclusive",
    retryLimit: adsConfig.jobRetryLimit,
    retryDelay: adsConfig.jobRetryDelaySeconds,
    expireInSeconds: adsConfig.expireInSeconds,
  });
  await boss.createQueue(googleAdsImpactQueue, {
    policy: "exclusive",
    retryLimit: adsConfig.jobRetryLimit,
    retryDelay: adsConfig.jobRetryDelaySeconds,
    expireInSeconds: adsConfig.expireInSeconds,
  });
  const conversionConfig = getGoogleDataManagerConfig();
  await boss.createQueue(googleConversionPlanQueue, {
    policy: "exclusive",
    retryLimit: conversionConfig.maxRetries,
    retryDelay: conversionConfig.jobRetryDelaySeconds,
    expireInSeconds: conversionConfig.expireInSeconds,
  });
  await boss.createQueue(googleConversionSubmitQueue, {
    policy: "exclusive",
    retryLimit: conversionConfig.maxRetries,
    retryDelay: conversionConfig.jobRetryDelaySeconds,
    expireInSeconds: conversionConfig.expireInSeconds,
  });
  await boss.createQueue(googleConversionStatusQueue, {
    policy: "exclusive",
    retryLimit: conversionConfig.maxRetries,
    retryDelay: conversionConfig.jobRetryDelaySeconds,
    expireInSeconds: conversionConfig.expireInSeconds,
  });
  await boss.createQueue(googleAdsAnalyticsSyncQueue, {
    policy: "exclusive",
    retryLimit: 2,
    retryDelay: adsConfig.jobRetryDelaySeconds,
    expireInSeconds: adsConfig.expireInSeconds,
  });
  await boss.createQueue(googleAdsAnalyticsBackfillQueue, {
    policy: "exclusive",
    retryLimit: 2,
    retryDelay: adsConfig.jobRetryDelaySeconds,
    expireInSeconds: adsConfig.expireInSeconds,
  });
  await boss.createQueue(googleAdsClickAttributionQueue, {
    policy: "exclusive",
    retryLimit: adsConfig.clickResolveRetryLimit,
    retryDelay: adsConfig.clickResolveRetryDelaySeconds,
    expireInSeconds: adsConfig.expireInSeconds,
  });
  return boss;
}

async function createNotificationQueue(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: getServerEnvironment().DATABASE_URL,
    application_name: "leadguard-notification-queue",
    max: 4,
  });
  boss.on("error", (error) => {
    logger.error("queue.error", { message: String(error) });
  });
  await boss.start();
  await boss.createQueue(notificationDeliveryQueue, {
    policy: "exclusive",
    retryLimit: 0,
    expireInSeconds: 60,
  });
  await boss.createQueue(outcomeImportQueue, {
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 30,
    expireInSeconds: 3600,
  });
  return boss;
}

export async function getMonitorQueue(): Promise<PgBoss> {
  globalQueue.monitorBoss ??= createMonitorQueue();
  return globalQueue.monitorBoss;
}

export async function getNotificationQueue(): Promise<PgBoss> {
  globalQueue.notificationBoss ??= createNotificationQueue();
  return globalQueue.notificationBoss;
}

export async function enqueueMonitorCheck(input: {
  monitorId: string;
  hostname: string;
  organizationId: string;
  websiteId: string;
  source: "scheduler" | "manual";
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    monitorCheckQueue,
    { monitorId: input.monitorId } satisfies MonitorCheckJobData,
    {
      singletonKey: input.monitorId,
      group: { id: input.hostname.toLowerCase() },
    },
  );
  if (jobId) {
    logger.info("monitor.job.enqueued", {
      jobId,
      monitorId: input.monitorId,
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      source: input.source,
    });
  }
  return jobId;
}

export async function enqueueBrowserMonitorCheck(input: {
  monitorId: string;
  hostname: string;
  organizationId: string;
  websiteId: string;
  source: "scheduler" | "manual";
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    browserCheckQueue,
    { monitorId: input.monitorId } satisfies MonitorCheckJobData,
    {
      singletonKey: input.monitorId,
      group: { id: `browser:${input.hostname.toLowerCase()}` },
    },
  );
  if (jobId) {
    logger.info("browser.job.enqueued", {
      jobId,
      monitorId: input.monitorId,
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      source: input.source,
    });
  }
  return jobId;
}

export async function enqueueFormMonitorCheck(input: {
  monitorId: string;
  hostname: string;
  organizationId: string;
  websiteId: string;
  source: "scheduler" | "manual";
  mode: "submit" | "validate";
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    formCheckQueue,
    {
      monitorId: input.monitorId,
      mode: input.mode,
      source: input.source,
    } satisfies FormCheckJobData,
    {
      singletonKey: `${input.monitorId}:${input.mode}`,
      group: { id: `form:${input.hostname.toLowerCase()}` },
    },
  );
  if (jobId) {
    logger.info("form.job.enqueued", {
      jobId,
      monitorId: input.monitorId,
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      source: input.source,
      mode: input.mode,
    });
  }
  return jobId;
}

export async function enqueueGoogleAdsSync(input: {
  connectionId: string;
  googleAdsCustomerId: string;
  organizationId: string;
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    googleAdsSyncQueue,
    {
      connectionId: input.connectionId,
      googleAdsCustomerId: input.googleAdsCustomerId,
    } satisfies GoogleAdsSyncJobData,
    {
      singletonKey: `${input.connectionId}:${input.googleAdsCustomerId}`,
    },
  );
  if (jobId) {
    logger.info("google_ads.sync.queued", {
      jobId,
      connectionId: input.connectionId,
      customerId: input.googleAdsCustomerId,
      organizationId: input.organizationId,
    });
  }
  return jobId;
}

export async function enqueueGoogleAdsImpact(input: {
  incidentId: string;
  organizationId?: string;
  reason: GoogleAdsImpactJobData["reason"];
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    googleAdsImpactQueue,
    {
      incidentId: input.incidentId,
      reason: input.reason,
    } satisfies GoogleAdsImpactJobData,
    {
      singletonKey: input.incidentId,
    },
  );
  if (jobId) {
    logger.info("google_ads.impact.queued", {
      jobId,
      incidentId: input.incidentId,
      organizationId: input.organizationId ?? null,
      reason: input.reason,
    });
  }
  return jobId;
}

export async function enqueueOutcomeImport(input: {
  importId: string;
  organizationId: string;
}): Promise<string | null> {
  const queue = await getNotificationQueue();
  const jobId = await queue.send(
    outcomeImportQueue,
    { importId: input.importId } satisfies OutcomeImportJobData,
    { singletonKey: input.importId },
  );
  if (jobId) {
    logger.info("outcome_import.queued", {
      importId: input.importId,
      organizationId: input.organizationId,
      jobId,
    });
  }
  return jobId;
}

export async function enqueueNotificationDelivery(
  deliveryId: string,
): Promise<string | null> {
  const queue = await getNotificationQueue();
  const jobId = await queue.send(
    notificationDeliveryQueue,
    { deliveryId } satisfies NotificationDeliveryJobData,
    { singletonKey: deliveryId },
  );
  if (jobId) {
    logger.info("notification.delivery.queued", {
      deliveryId,
      jobId,
    });
  }
  return jobId;
}

export async function enqueueGoogleConversionPlan(input: {
  leadId: string;
  organizationId: string;
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    googleConversionPlanQueue,
    {
      leadId: input.leadId,
      organizationId: input.organizationId,
    } satisfies GoogleConversionPlanJobData,
    { singletonKey: input.leadId },
  );
  if (jobId) {
    logger.info("google_conversion.plan.queued", {
      jobId,
      leadId: input.leadId,
      organizationId: input.organizationId,
    });
  }
  return jobId;
}

export async function enqueueGoogleConversionSubmit(
  exportId: string,
  delaySeconds = 0,
): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    googleConversionSubmitQueue,
    { exportId } satisfies GoogleConversionExportJobData,
    {
      singletonKey: exportId,
      startAfter: delaySeconds > 0 ? delaySeconds : undefined,
    },
  );
  if (jobId) {
    logger.info("google_conversion.submit.queued", {
      jobId,
      exportId,
    });
  }
  return jobId;
}

export async function enqueueGoogleConversionStatus(
  exportId: string,
  delaySeconds = 0,
): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    googleConversionStatusQueue,
    { exportId } satisfies GoogleConversionExportJobData,
    {
      singletonKey: `status:${exportId}`,
      startAfter: delaySeconds > 0 ? delaySeconds : undefined,
    },
  );
  if (jobId) {
    logger.info("google_conversion.status.queued", {
      jobId,
      exportId,
    });
  }
  return jobId;
}

export async function enqueueGoogleAdsAnalyticsSync(input: {
  googleAdsCustomerId: string;
  organizationId: string;
  kind?: GoogleAdsAnalyticsSyncJobData["kind"];
  days?: number;
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const kind = input.kind ?? "RECENT";
  const jobId = await queue.send(
    kind === "BACKFILL"
      ? googleAdsAnalyticsBackfillQueue
      : googleAdsAnalyticsSyncQueue,
    {
      googleAdsCustomerId: input.googleAdsCustomerId,
      organizationId: input.organizationId,
      kind,
      days: input.days,
    } satisfies GoogleAdsAnalyticsSyncJobData,
    {
      singletonKey: input.googleAdsCustomerId,
    },
  );
  if (jobId) {
    logger.info("google_ads.analytics.queued", {
      jobId,
      customerId: input.googleAdsCustomerId,
      organizationId: input.organizationId,
      kind,
    });
  }
  return jobId;
}

export async function enqueueGoogleAdsAnalyticsBackfill(input: {
  googleAdsCustomerId: string;
  organizationId: string;
  days?: number;
}): Promise<string | null> {
  return enqueueGoogleAdsAnalyticsSync({
    ...input,
    kind: "BACKFILL",
  });
}

export async function enqueueGoogleAdsClickResolution(input: {
  organizationId: string;
  googleAdsCustomerId: string;
  leadId?: string;
}): Promise<string | null> {
  const queue = await getMonitorQueue();
  const jobId = await queue.send(
    googleAdsClickAttributionQueue,
    {
      organizationId: input.organizationId,
      googleAdsCustomerId: input.googleAdsCustomerId,
      leadId: input.leadId,
    } satisfies GoogleAdsClickResolutionJobData,
    {
      singletonKey: input.googleAdsCustomerId,
    },
  );
  if (jobId) {
    logger.info("google_ads.attribution.queued", {
      jobId,
      organizationId: input.organizationId,
      customerId: input.googleAdsCustomerId,
      leadId: input.leadId ?? null,
    });
  }
  return jobId;
}

export async function stopMonitorQueue(timeoutMs = 25_000): Promise<void> {
  const pending = globalQueue.monitorBoss;
  globalQueue.monitorBoss = undefined;
  if (!pending) return;
  const queue = await pending;
  await queue.stop({ graceful: true, timeout: timeoutMs });
}

export async function stopNotificationQueue(timeoutMs = 25_000): Promise<void> {
  const pending = globalQueue.notificationBoss;
  globalQueue.notificationBoss = undefined;
  if (!pending) return;
  const queue = await pending;
  await queue.stop({ graceful: true, timeout: timeoutMs });
}
