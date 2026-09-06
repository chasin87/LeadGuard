import { database } from "@/server/database";
import { getQueueBacklogSnapshot } from "@/server/ops/queue-health";
import { heartbeatHealth } from "@/server/platform-admin/health";

function startOfUtcDay(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function getPlatformOverview() {
  const today = startOfUtcDay();
  const [
    organizationCount,
    billingGroups,
    trialCount,
    manualSuspended,
    websiteCount,
    monitorCount,
    openIncidents,
    leadsToday,
    wonToday,
    revenueKnown,
    googleConnections,
    conversionErrors,
    unmatchedOrgCount,
    queue,
    heartbeats,
  ] = await Promise.all([
    database.organization.count(),
    database.billingSubscription.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    database.billingSubscription.count({ where: { status: "TRIALING" } }),
    database.organization.count({
      where: { manualSuspendedAt: { not: null } },
    }),
    database.website.count({ where: { status: "ACTIVE" } }),
    database.monitor.count({ where: { deletedAt: null } }),
    database.incident.count({ where: { status: "OPEN" } }),
    database.lead.count({ where: { createdAt: { gte: today } } }),
    database.leadOutcome.count({
      where: { status: "WON", wonAt: { gte: today } },
    }),
    database.leadOutcome.groupBy({
      by: ["revenueCurrencyCode"],
      where: {
        status: "WON",
        revenueAmountMinor: { not: null },
        revenueCurrencyCode: { not: null },
      },
      _count: { _all: true },
    }),
    database.googleAdsConnection.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    database.googleAdsConversionExport.groupBy({
      by: ["status"],
      where: {
        status: { in: ["RETRYABLE_ERROR", "REJECTED", "NEEDS_REVIEW"] },
      },
      _count: { _all: true },
    }),
    database.externalOutcomeEvent.groupBy({
      by: ["organizationId"],
      where: { status: "UNMATCHED" },
    }),
    getQueueBacklogSnapshot(),
    database.workerHeartbeat.findMany(),
  ]);

  const billing = Object.fromEntries(
    billingGroups.map((row) => [row.status, row._count._all]),
  );
  const conversionErrorCount = conversionErrors.reduce(
    (sum, row) => sum + row._count._all,
    0,
  );
  const workerStatus = heartbeatHealth(
    heartbeats.reduce<Date | null>((latest, row) => {
      if (!latest || row.lastSeenAt > latest) return row.lastSeenAt;
      return latest;
    }, null),
  );

  return {
    organizations: organizationCount,
    subscriptions: {
      active: (billing.ACTIVE ?? 0) + (billing.TRIALING ?? 0),
      trials: trialCount,
      pastDue: (billing.PAST_DUE ?? 0) + (billing.GRACE_PERIOD ?? 0),
      suspended: (billing.SUSPENDED ?? 0) + manualSuspended,
      billingSuspended: billing.SUSPENDED ?? 0,
      manualSuspended,
    },
    websites: websiteCount,
    monitors: monitorCount,
    openIncidents,
    leadsToday,
    wonLeadsToday: wonToday,
    revenueKnownCurrencies: revenueKnown
      .map((row) => row.revenueCurrencyCode)
      .filter((code): code is string => Boolean(code)),
    googleAds: Object.fromEntries(
      googleConnections.map((row) => [row.status, row._count._all]),
    ),
    conversionFeedbackErrors: conversionErrorCount,
    unmatchedOutcomeOrganizations: unmatchedOrgCount.length,
    queue,
    workerStatus,
  };
}
