import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import {
  getGoogleAdsReadProvider,
  mapProviderFailure,
} from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { refreshGoogleConnectionAccessToken } from "@/server/google-ads/tokens";
import { incrementGoogleAdsAnalyticsMetric } from "@/server/google-ads/analytics-metrics";
import type { GoogleAdsReadSession } from "@/server/google-ads/provider";
import {
  addIsoDays,
  subtractCalendarMonths,
  todayInTimeZone,
  utcDateFromIso,
} from "@/server/revenue-analytics/dates";
import type { GoogleAdsAnalyticsSyncKind } from "@/generated/prisma/enums";

const logger = createLogger("google-ads-analytics");

export function clampDailyReportingRange(input: {
  from: string;
  through: string;
  today: string;
  lookbackMonths: number;
}): { from: string; through: string } {
  const minDate = subtractCalendarMonths(input.today, input.lookbackMonths);
  const through = input.through > input.today ? input.today : input.through;
  const from = input.from < minDate ? minDate : input.from;
  if (from > through) return { from: through, through };
  return { from, through };
}

async function loadReadSession(
  connection: {
    encryptedRefreshToken: string | null;
  },
  loginCustomerId: string | null,
): Promise<GoogleAdsReadSession> {
  const config = getGoogleAdsConfig();
  const accessToken = await refreshGoogleConnectionAccessToken(connection);
  return {
    accessToken,
    developerToken: config.developerToken || "fake-developer-token",
    loginCustomerId,
  };
}

export async function executeGoogleAdsAnalyticsSync(input: {
  googleAdsCustomerId: string;
  organizationId: string;
  kind: GoogleAdsAnalyticsSyncKind;
  days?: number;
}) {
  const ads = getGoogleAdsConfig();
  const customer = await database.googleAdsCustomer.findFirst({
    where: {
      id: input.googleAdsCustomerId,
      organizationId: input.organizationId,
    },
    include: { connection: true },
  });
  if (!customer || customer.isManager) return "skipped";
  const activeConfig = await database.googleAdsAnalyticsConfig.findFirst({
    where: {
      googleAdsCustomerId: customer.id,
      organizationId: customer.organizationId,
      status: { in: ["ACTIVE", "ERROR", "NEEDS_REAUTH"] },
    },
  });
  if (!activeConfig) return "skipped";
  if (customer.connection.status === "DISCONNECTED") return "skipped";

  const timeZone = customer.timeZone || "UTC";
  const today = todayInTimeZone(new Date(), timeZone);
  const requestedDays =
    input.kind === "BACKFILL"
      ? Math.min(
          input.days ?? ads.analyticsDefaultBackfillDays,
          ads.analyticsMaxBackfillDays,
        )
      : input.kind === "MANUAL"
        ? Math.min(
            input.days ?? ads.analyticsPeriodicRefreshDays,
            ads.analyticsPeriodicRefreshDays,
          )
        : ads.analyticsRecentRefreshDays;
  const unclampedFrom = addIsoDays(today, -(requestedDays - 1));
  const range = clampDailyReportingRange({
    from: unclampedFrom,
    through: today,
    today,
    lookbackMonths: ads.analyticsDailyLookbackMonths,
  });

  const run = await database.googleAdsAnalyticsSyncRun.create({
    data: {
      organizationId: customer.organizationId,
      googleAdsCustomerId: customer.id,
      configId: activeConfig.id,
      kind: input.kind,
      status: "RUNNING",
      rangeFrom: utcDateFromIso(range.from),
      rangeThrough: utcDateFromIso(range.through),
    },
  });
  await database.googleAdsAnalyticsConfig.updateMany({
    where: {
      googleAdsCustomerId: customer.id,
      organizationId: customer.organizationId,
    },
    data: { lastSyncAttemptAt: new Date() },
  });
  logger.info("google_ads.analytics.sync_started", {
    organizationId: customer.organizationId,
    customerId: customer.id,
    kind: input.kind,
    rangeFrom: range.from,
    rangeThrough: range.through,
  });
  incrementGoogleAdsAnalyticsMetric("google_ads_analytics_syncs_total");

  try {
    const session = await loadReadSession(
      customer.connection,
      customer.loginCustomerId,
    );
    const provider = getGoogleAdsReadProvider();
    const [accountRows, campaignRows] = await Promise.all([
      provider.getCustomerDailyPerformance(session, customer.googleCustomerId, {
        fromDate: range.from,
        toDate: range.through,
      }),
      provider.getCampaignDailyPerformance(session, customer.googleCustomerId, {
        fromDate: range.from,
        toDate: range.through,
      }),
    ]);
    const currencyCode = customer.currencyCode || "EUR";
    const now = new Date();
    let upserted = 0;

    for (const row of accountRows) {
      await database.googleAdsPerformanceDaily.upsert({
        where: {
          googleAdsCustomerId_date_dimensionType_campaignId: {
            googleAdsCustomerId: customer.id,
            date: utcDateFromIso(row.date),
            dimensionType: "ACCOUNT",
            campaignId: "",
          },
        },
        create: {
          organizationId: customer.organizationId,
          googleAdsCustomerId: customer.id,
          date: utcDateFromIso(row.date),
          dimensionType: "ACCOUNT",
          campaignId: "",
          costMicros: row.costMicros,
          clicks: row.clicks,
          impressions: row.impressions,
          currencyCode,
          customerTimeZone: timeZone,
          syncRunId: run.id,
          lastSyncedAt: now,
        },
        update: {
          costMicros: row.costMicros,
          clicks: row.clicks,
          impressions: row.impressions,
          currencyCode,
          customerTimeZone: timeZone,
          syncRunId: run.id,
          lastSyncedAt: now,
        },
      });
      upserted += 1;
    }

    for (const row of campaignRows) {
      await database.googleAdsPerformanceDaily.upsert({
        where: {
          googleAdsCustomerId_date_dimensionType_campaignId: {
            googleAdsCustomerId: customer.id,
            date: utcDateFromIso(row.date),
            dimensionType: "CAMPAIGN",
            campaignId: row.campaignId,
          },
        },
        create: {
          organizationId: customer.organizationId,
          googleAdsCustomerId: customer.id,
          date: utcDateFromIso(row.date),
          dimensionType: "CAMPAIGN",
          campaignId: row.campaignId,
          campaignNameSnapshot: row.campaignName,
          campaignStatus: row.campaignStatus,
          advertisingChannelType: row.advertisingChannelType,
          costMicros: row.costMicros,
          clicks: row.clicks,
          impressions: row.impressions,
          currencyCode,
          customerTimeZone: timeZone,
          syncRunId: run.id,
          lastSyncedAt: now,
        },
        update: {
          campaignNameSnapshot: row.campaignName,
          campaignStatus: row.campaignStatus,
          advertisingChannelType: row.advertisingChannelType,
          costMicros: row.costMicros,
          clicks: row.clicks,
          impressions: row.impressions,
          currencyCode,
          customerTimeZone: timeZone,
          syncRunId: run.id,
          lastSyncedAt: now,
        },
      });
      upserted += 1;
    }

    await database.googleAdsAnalyticsSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        completedAt: now,
        accountRows: accountRows.length,
        campaignRows: campaignRows.length,
      },
    });
    const nextSyncAt = new Date(
      now.getTime() + ads.analyticsSyncIntervalSeconds * 1000,
    );
    await database.googleAdsAnalyticsConfig.updateMany({
      where: {
        googleAdsCustomerId: customer.id,
        organizationId: customer.organizationId,
      },
      data: {
        status: "ACTIVE",
        lastSuccessfulSyncAt: now,
        lastErrorCode: null,
        nextSyncAt,
        ...(input.kind === "BACKFILL" ? { lastBackfillAt: now } : {}),
        ...(input.kind === "MANUAL" ? { lastManualRefreshAt: now } : {}),
      },
    });
    incrementGoogleAdsAnalyticsMetric(
      "google_ads_analytics_rows_upserted",
      upserted,
    );
    logger.info("google_ads.analytics.sync_completed", {
      organizationId: customer.organizationId,
      customerId: customer.id,
      kind: input.kind,
      accountRows: accountRows.length,
      campaignRows: campaignRows.length,
    });
    return "completed";
  } catch (error) {
    const mapped = mapProviderFailure(error);
    await database.googleAdsAnalyticsSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: mapped.code,
      },
    });
    const nextStatus = mapped.authFailure ? "NEEDS_REAUTH" : "ERROR";
    await database.googleAdsAnalyticsConfig.updateMany({
      where: {
        googleAdsCustomerId: customer.id,
        organizationId: customer.organizationId,
        status: { not: "DISABLED" },
      },
      data: {
        status: nextStatus,
        lastErrorCode: mapped.code,
      },
    });
    if (mapped.authFailure) {
      await database.googleAdsConnection.update({
        where: { id: customer.connectionId },
        data: { status: "REAUTH_REQUIRED", lastSyncErrorCode: mapped.code },
      });
    }
    logger.warn("google_ads.analytics.sync_failed", {
      organizationId: customer.organizationId,
      customerId: customer.id,
      kind: input.kind,
      errorCode: mapped.code,
    });
    throw error;
  }
}
