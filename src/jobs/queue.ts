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
import {
  getGoogleAdsConfig,
  googleAdsImpactQueue,
  googleAdsSyncQueue,
} from "@/server/google-ads/config";

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

export type GoogleAdsSyncJobData = {
  connectionId: string;
  googleAdsCustomerId: string;
};

export type GoogleAdsImpactJobData = {
  incidentId: string;
  reason: "open" | "refresh" | "finalize" | "reconcile" | "manual";
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
