import { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { getMonitoringConfig } from "@/server/monitoring/config";
import { cleanupExpiredScreenshots } from "@/server/monitoring/browser/artifacts";
import {
  enqueueBrowserMonitorCheck,
  enqueueFormMonitorCheck,
  enqueueMonitorCheck,
} from "@/jobs/queue";
import { timeoutDueReceiptVerifications } from "@/server/receipts/service";
import { claimDueGoogleAdsCustomers } from "@/server/google-ads/sync";
import { claimDueGoogleAdsImpacts } from "@/server/google-ads/impact/refresh";
import { enqueueGoogleAdsImpact, enqueueGoogleAdsSync } from "@/jobs/queue";

const logger = createLogger("scheduler");

export type ClaimedMonitor = {
  id: string;
  type: "HTTP" | "BROWSER" | "FORM" | "AD_DESTINATION";
  intervalSeconds: number;
  hostname: string;
  organizationId: string;
  websiteId: string;
};

export async function claimDueMonitors(
  now = new Date(),
  batchSize = getMonitoringConfig().schedulerBatchSize,
): Promise<ClaimedMonitor[]> {
  return database.$transaction(async (tx) => {
    const due = await tx.$queryRaw<ClaimedMonitor[]>(Prisma.sql`
      SELECT
        m.id,
        m.type,
        m."intervalSeconds",
        w.hostname,
        w."organizationId",
        m."websiteId"
      FROM "Monitor" m
      INNER JOIN "Website" w ON w.id = m."websiteId"
      WHERE m.status = 'ACTIVE'
        AND m."deletedAt" IS NULL
        AND w.status = 'ACTIVE'
        AND m."nextCheckAt" <= ${now}
        AND (
          m.type <> 'FORM'
          OR EXISTS (
            SELECT 1 FROM "FormMonitorConfig" f
            WHERE f."monitorId" = m.id
              AND f."configurationStatus" = 'VERIFIED'
              AND f."consentedAt" IS NOT NULL
              AND (
                f."receiptMode" = 'NONE'
                OR f."receiptVerifiedAt" IS NOT NULL
              )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM "LeadReceiptVerification" v
          WHERE v."monitorId" = m.id AND v.status = 'PENDING'
        )
      ORDER BY m."nextCheckAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE OF m SKIP LOCKED
    `);

    for (const row of due) {
      const nextCheckAt = new Date(now.getTime() + row.intervalSeconds * 1000);
      await tx.monitor.update({
        where: { id: row.id },
        data: { nextCheckAt },
      });
      logger.info("scheduler.monitor.claimed", {
        monitorId: row.id,
        organizationId: row.organizationId,
        websiteId: row.websiteId,
      });
    }

    return due;
  });
}

export async function scheduleDueMonitors(now = new Date()): Promise<number> {
  await timeoutDueReceiptVerifications(now).catch((error: unknown) => {
    logger.warn("scheduler.receipt_timeout_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  const claimed = await claimDueMonitors(now);
  let enqueued = 0;
  for (const monitor of claimed) {
    try {
      const payload = {
        monitorId: monitor.id,
        hostname: monitor.hostname,
        organizationId: monitor.organizationId,
        websiteId: monitor.websiteId,
        source: "scheduler" as const,
      };
      const jobId =
        monitor.type === "BROWSER"
          ? await enqueueBrowserMonitorCheck(payload)
          : monitor.type === "FORM"
            ? await enqueueFormMonitorCheck({ ...payload, mode: "submit" })
            : await enqueueMonitorCheck(payload);
      if (jobId) enqueued += 1;
    } catch (error) {
      logger.error("scheduler.enqueue_failed", {
        monitorId: monitor.id,
        organizationId: monitor.organizationId,
        websiteId: monitor.websiteId,
        message: error instanceof Error ? error.message : "unknown",
      });
      await database.monitor.update({
        where: { id: monitor.id },
        data: { nextCheckAt: now },
      });
    }
  }
  await cleanupExpiredScreenshots(now).catch((error: unknown) => {
    logger.warn("scheduler.screenshot_cleanup_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  try {
    const dueCustomers = await claimDueGoogleAdsCustomers(now);
    for (const customer of dueCustomers) {
      const jobId = await enqueueGoogleAdsSync({
        connectionId: customer.connectionId,
        googleAdsCustomerId: customer.googleCustomerId,
        organizationId: customer.organizationId,
      });
      if (jobId) enqueued += 1;
    }
  } catch (error) {
    logger.error("scheduler.google_ads_enqueue_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  try {
    const dueImpacts = await claimDueGoogleAdsImpacts(now);
    for (const impact of dueImpacts) {
      const jobId = await enqueueGoogleAdsImpact({
        incidentId: impact.incidentId,
        reason: impact.reason,
      });
      if (jobId) enqueued += 1;
    }
  } catch (error) {
    logger.error("scheduler.google_ads_impact_enqueue_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  return enqueued;
}
