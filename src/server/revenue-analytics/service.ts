import { database } from "@/server/database";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import {
  isoFromUtcDate,
  startOfZonedDate,
  todayInTimeZone,
} from "@/server/revenue-analytics/dates";
import {
  calculateRevenueAnalytics,
  shiftRangePreset,
} from "@/server/revenue-analytics/calculator";
import type {
  AnalyticsLeadInput,
  AnalyticsSpendRowInput,
  LeadResolutionStatus,
  OutcomeStatus,
  RevenueAnalyticsResult,
} from "@/server/revenue-analytics/types";

export type RevenueAnalyticsQuery = {
  range?: "7" | "30" | "90" | "custom";
  from?: string;
  to?: string;
  customerId?: string;
  websiteIds?: string[];
  sort?: "spend" | "revenue" | "roas" | "leads";
};

async function requireRead(userId: string, organizationSlug: string) {
  return requireOrganizationRole(userId, organizationSlug, "integrations:read");
}

export async function listAnalyticsAccounts(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireRead(userId, organizationSlug);
  const configs = await database.googleAdsAnalyticsConfig.findMany({
    where: {
      organizationId: organization.id,
      status: { in: ["ACTIVE", "ERROR", "NEEDS_REAUTH"] },
    },
    include: {
      customer: true,
      website: { select: { id: true, name: true, hostname: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const byCustomer = new Map<
    string,
    {
      customerId: string;
      googleCustomerId: string;
      descriptiveName: string;
      currencyCode: string | null;
      timeZone: string | null;
      status: string;
      lastSuccessfulSyncAt: Date | null;
      lastErrorCode: string | null;
      websites: Array<{ id: string; name: string; hostname: string }>;
    }
  >();
  for (const config of configs) {
    const current = byCustomer.get(config.googleAdsCustomerId) ?? {
      customerId: config.customer.id,
      googleCustomerId: config.customer.googleCustomerId,
      descriptiveName: config.customer.descriptiveName,
      currencyCode: config.customer.currencyCode,
      timeZone: config.customer.timeZone,
      status: config.status,
      lastSuccessfulSyncAt: config.lastSuccessfulSyncAt,
      lastErrorCode: config.lastErrorCode,
      websites: [],
    };
    if (
      !current.lastSuccessfulSyncAt ||
      (config.lastSuccessfulSyncAt &&
        config.lastSuccessfulSyncAt > current.lastSuccessfulSyncAt)
    ) {
      current.lastSuccessfulSyncAt = config.lastSuccessfulSyncAt;
    }
    if (config.status === "NEEDS_REAUTH") current.status = "NEEDS_REAUTH";
    current.websites.push(config.website);
    byCustomer.set(config.googleAdsCustomerId, current);
  }
  return {
    organization,
    accounts: [...byCustomer.values()],
  };
}

export async function getRevenueAnalyticsDashboard(
  userId: string,
  organizationSlug: string,
  query: RevenueAnalyticsQuery,
): Promise<{
  empty: boolean;
  reauthRequired: boolean;
  account:
    | Awaited<ReturnType<typeof listAnalyticsAccounts>>["accounts"][number]
    | null;
  accounts: Awaited<ReturnType<typeof listAnalyticsAccounts>>["accounts"];
  selectedWebsiteIds: string[];
  range: {
    from: string;
    through: string;
    preset: RevenueAnalyticsQuery["range"];
  };
  analytics: RevenueAnalyticsResult | null;
}> {
  const { organization, accounts } = await listAnalyticsAccounts(
    userId,
    organizationSlug,
  );
  if (accounts.length === 0) {
    return {
      empty: true,
      reauthRequired: false,
      account: null,
      accounts,
      selectedWebsiteIds: [],
      range: { from: "", through: "", preset: query.range ?? "30" },
      analytics: null,
    };
  }
  const account =
    accounts.find((item) => item.customerId === query.customerId) ??
    accounts[0]!;
  const mappedWebsiteIds = account.websites.map((item) => item.id);
  const selectedWebsiteIds =
    query.websiteIds && query.websiteIds.length > 0
      ? query.websiteIds.filter((id) => mappedWebsiteIds.includes(id))
      : mappedWebsiteIds;
  const timeZone = account.timeZone || "UTC";
  const today = todayInTimeZone(new Date(), timeZone);
  const preset = query.range ?? "30";
  const computed =
    preset === "custom" && query.from && query.to
      ? { from: query.from, through: query.to }
      : shiftRangePreset(preset === "custom" ? "30" : preset, today);
  const ads = getGoogleAdsConfig();
  const websiteFilter =
    selectedWebsiteIds.length === mappedWebsiteIds.length
      ? "ALL_MAPPED"
      : "SUBSET";

  const rangeStart = startOfZonedDate(computed.from, timeZone);
  const rangeEnd = startOfZonedDate(
    isoFromUtcDate(
      new Date(
        startOfZonedDate(computed.through, timeZone).getTime() + 86_400_000,
      ),
    ),
    timeZone,
  );
  const paddedStart = new Date(rangeStart.getTime() - 86_400_000);
  const paddedEnd = new Date(rangeEnd.getTime() + 86_400_000);

  const [spendRows, leadRows, feedbackCounts] = await Promise.all([
    database.googleAdsPerformanceDaily.findMany({
      where: {
        organizationId: organization.id,
        googleAdsCustomerId: account.customerId,
        date: {
          gte: startOfZonedDate(computed.from, "UTC"),
          lte: startOfZonedDate(computed.through, "UTC"),
        },
      },
    }),
    database.lead.findMany({
      where: {
        organizationId: organization.id,
        websiteId: { in: selectedWebsiteIds },
        attribution: { attributionStatus: "ATTRIBUTED" },
        OR: [
          {
            attribution: {
              primaryTouch: {
                capturedAt: { gte: paddedStart, lte: paddedEnd },
              },
            },
          },
          {
            googleAdsLeadAttributionResolution: {
              googleClickDate: {
                gte: startOfZonedDate(computed.from, "UTC"),
                lte: startOfZonedDate(computed.through, "UTC"),
              },
            },
          },
        ],
      },
      include: {
        outcome: true,
        attribution: { include: { primaryTouch: true } },
        googleAdsLeadAttributionResolution: true,
      },
    }),
    database.googleAdsConversionExport.groupBy({
      by: ["status"],
      where: {
        organizationId: organization.id,
        googleAdsCustomerId: account.googleCustomerId,
        websiteId: { in: selectedWebsiteIds },
      },
      _count: { _all: true },
    }),
  ]);

  const spendInputs: AnalyticsSpendRowInput[] = spendRows.map((row) => ({
    date: isoFromUtcDate(row.date),
    dimensionType: row.dimensionType,
    campaignId: row.campaignId,
    campaignNameSnapshot: row.campaignNameSnapshot,
    campaignStatus: row.campaignStatus,
    advertisingChannelType: row.advertisingChannelType,
    costMicros: row.costMicros,
    clicks: row.clicks,
    impressions: row.impressions,
    currencyCode: row.currencyCode,
  }));

  const leads: AnalyticsLeadInput[] = leadRows.flatMap((row) => {
    const touch = row.attribution?.primaryTouch;
    if (!touch) return [];
    if (!touch.hasGclid && !touch.hasGbraid && !touch.hasWbraid) return [];
    const resolution = row.googleAdsLeadAttributionResolution;
    return [
      {
        leadId: row.id,
        websiteId: row.websiteId,
        outcomeStatus: (row.outcome?.status ?? "NEW") as OutcomeStatus,
        revenueAmountMinor: row.outcome?.revenueAmountMinor ?? null,
        revenueCurrencyCode: row.outcome?.revenueCurrencyCode ?? null,
        acquisitionCapturedAt: touch.capturedAt,
        googleClickDate: resolution?.googleClickDate
          ? isoFromUtcDate(resolution.googleClickDate)
          : null,
        campaignId: resolution?.campaignId ?? null,
        campaignNameSnapshot: resolution?.campaignNameSnapshot ?? null,
        resolutionStatus: (resolution?.status ??
          "ACCOUNT_RESOLVED") as LeadResolutionStatus,
        wonAt: row.outcome?.wonAt ?? null,
      },
    ];
  });

  const tally = Object.fromEntries(
    feedbackCounts.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;

  let analytics = calculateRevenueAnalytics({
    rangeFrom: computed.from,
    rangeThrough: computed.through,
    timeZone,
    spendCurrencyCode: account.currencyCode || "EUR",
    now: new Date(),
    lastSpendSyncedAt: account.lastSuccessfulSyncAt,
    spendFreshDelayedAfterHours: ads.analyticsSpendDelayedAfterHours,
    spendFreshStaleAfterHours: ads.analyticsSpendStaleAfterHours,
    maturityWindowDays: ads.analyticsCohortMaturityDays,
    websiteFilter,
    spendRows: spendInputs,
    leads,
    feedback: {
      succeeded: tally.SUCCEEDED ?? 0,
      processing: (tally.PROCESSING ?? 0) + (tally.SUBMITTING ?? 0),
      needsAttention:
        (tally.NEEDS_REVIEW ?? 0) +
        (tally.REJECTED ?? 0) +
        (tally.OUT_OF_SYNC ?? 0) +
        (tally.BLOCKED ?? 0),
    },
  });

  if (query.sort && query.sort !== "spend") {
    analytics = {
      ...analytics,
      campaigns: [...analytics.campaigns].sort((left, right) => {
        if (query.sort === "leads") return right.leads.value - left.leads.value;
        if (query.sort === "revenue") {
          const leftRev = left.revenue.amountMinor ?? -1n;
          const rightRev = right.revenue.amountMinor ?? -1n;
          if (leftRev === rightRev) return 0;
          return leftRev < rightRev ? 1 : -1;
        }
        const leftRoas = left.roas.timesHundredths ?? -1n;
        const rightRoas = right.roas.timesHundredths ?? -1n;
        if (leftRoas === rightRoas) return 0;
        return leftRoas < rightRoas ? 1 : -1;
      }),
    };
  }

  return {
    empty: false,
    reauthRequired:
      account.status === "NEEDS_REAUTH" ||
      analytics.freshness.spend === "STALE",
    account,
    accounts,
    selectedWebsiteIds,
    range: { ...computed, preset },
    analytics,
  };
}
