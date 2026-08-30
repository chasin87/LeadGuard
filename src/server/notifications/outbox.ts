import { Prisma } from "@/generated/prisma/client";
import type { MonitorCheckErrorType } from "@/generated/prisma/enums";
import { createLogger } from "@/server/logger";
import { incidentDurationMs } from "@/lib/incidents/duration";
import type { IncidentNotificationEventType } from "@/server/notifications/payload";
import type { IncidentNotificationPayloadV1 } from "@/server/notifications/payload";
import { getGoogleAdsContextForMonitor } from "@/server/google-ads/context";

const logger = createLogger("notifications");

type Transaction = Prisma.TransactionClient;

export async function insertIncidentOutboxEvent(
  tx: Transaction,
  input: {
    organizationId: string;
    websiteId: string;
    monitorId: string;
    incidentId: string;
    eventType: IncidentNotificationEventType;
    startedAt: Date;
    detectedAt: Date;
    resolvedAt: Date | null;
    errorType: MonitorCheckErrorType | null;
    httpStatus: number | null;
    recoveryHttpStatus: number | null;
  },
): Promise<"created" | "duplicate"> {
  const monitor = await tx.monitor.findFirst({
    where: { id: input.monitorId },
    select: {
      id: true,
      name: true,
      normalizedUrl: true,
      website: {
        select: {
          id: true,
          name: true,
          hostname: true,
          normalizedUrl: true,
          organization: { select: { id: true, slug: true } },
        },
      },
    },
  });
  if (!monitor) {
    logger.warn("notification.outbox.skipped", {
      reason: "monitor_missing",
      incidentId: input.incidentId,
      monitorId: input.monitorId,
    });
    return "duplicate";
  }

  const latestCheck = await tx.monitorCheck.findFirst({
    where: { monitorId: input.monitorId },
    orderBy: { createdAt: "desc" },
    select: { errorMessage: true },
  });

  const ads = await getGoogleAdsContextForMonitor(input.monitorId);
  const impact = await tx.googleAdsIncidentImpact.findUnique({
    where: { incidentId: input.incidentId },
    select: {
      status: true,
      windowCostMicros: true,
      currencyCode: true,
      confidence: true,
    },
  });
  const payload: IncidentNotificationPayloadV1 = {
    version: 1,
    eventType: input.eventType,
    organizationId: input.organizationId,
    organizationSlug: monitor.website.organization.slug,
    incidentId: input.incidentId,
    monitorId: input.monitorId,
    websiteId: input.websiteId,
    websiteName: monitor.website.name,
    websiteHostname: monitor.website.hostname,
    websiteUrl: monitor.website.normalizedUrl,
    monitorName: monitor.name,
    monitorUrl: monitor.normalizedUrl,
    startedAt: input.startedAt.toISOString(),
    detectedAt: input.detectedAt.toISOString(),
    resolvedAt: input.resolvedAt?.toISOString() ?? null,
    errorType: input.errorType,
    errorMessage: latestCheck?.errorMessage ?? null,
    httpStatus: input.httpStatus,
    recoveryHttpStatus: input.recoveryHttpStatus,
    durationMs: incidentDurationMs(input.startedAt, input.resolvedAt),
    googleAds: ads
      ? {
          enabledReferenceCount: ads.enabledReferenceCount,
          campaignNames: ads.campaignNames,
          additionalCampaignCount: ads.additionalCampaignCount,
          impactStatus: impact?.status,
          impactCostMicros: impact?.windowCostMicros?.toString(),
          impactCurrency: impact?.currencyCode,
          impactConfidence: impact?.confidence,
        }
      : null,
  };

  try {
    await tx.$executeRaw`SAVEPOINT notification_outbox_insert`;
    await tx.notificationOutboxEvent.create({
      data: {
        organizationId: input.organizationId,
        eventType: input.eventType,
        aggregateType: "Incident",
        aggregateId: input.incidentId,
        payload,
        status: "PENDING",
      },
    });
    await tx.$executeRaw`RELEASE SAVEPOINT notification_outbox_insert`;
    logger.info("notification.outbox.created", {
      organizationId: input.organizationId,
      incidentId: input.incidentId,
      eventType: input.eventType,
    });
    return "created";
  } catch (error) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT notification_outbox_insert`;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      logger.info("notification.outbox.duplicate", {
        organizationId: input.organizationId,
        incidentId: input.incidentId,
        eventType: input.eventType,
      });
      return "duplicate";
    }
    throw error;
  }
}
