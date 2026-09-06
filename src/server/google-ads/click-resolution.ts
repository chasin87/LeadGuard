import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import {
  getGoogleAdsReadProvider,
  mapProviderFailure,
} from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { isSafeGaqlGclid } from "@/server/google-ads/queries";
import { refreshGoogleConnectionAccessToken } from "@/server/google-ads/tokens";
import { incrementGoogleAdsAnalyticsMetric } from "@/server/google-ads/analytics-metrics";
import { decryptClickId } from "@/server/tracking/click-crypto";
import {
  addIsoDays,
  cohortDateForLead,
  daysBetweenIso,
  todayInTimeZone,
  utcDateFromIso,
} from "@/server/revenue-analytics/dates";
import { zonedDateHour } from "@/server/google-ads/impact/timezone";
import type { GoogleAdsClickViewRow } from "@/server/google-ads/provider";
import type {
  GoogleAdsLeadAttributionResolutionMethod,
  GoogleAdsLeadAttributionResolutionStatus,
} from "@/generated/prisma/enums";

const logger = createLogger("google-ads-attribution");

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function ensureLeadClickResolution(input: {
  leadId: string;
  organizationId: string;
}) {
  const lead = await database.lead.findFirst({
    where: { id: input.leadId, organizationId: input.organizationId },
    include: {
      attribution: { include: { primaryTouch: true } },
      website: {
        include: {
          googleAdsAnalyticsConfig: { include: { customer: true } },
        },
      },
    },
  });
  if (!lead?.attribution?.primaryTouch) return null;
  if (lead.attribution.attributionStatus !== "ATTRIBUTED") return null;
  const config = lead.website.googleAdsAnalyticsConfig;
  if (!config || config.status !== "ACTIVE") return null;
  const touch = lead.attribution.primaryTouch;
  if (!touch.hasGclid && !touch.hasGbraid && !touch.hasWbraid) return null;
  const existing = await database.googleAdsLeadAttributionResolution.findUnique(
    {
      where: { leadId: lead.id },
    },
  );
  if (existing) return existing;
  return database.googleAdsLeadAttributionResolution.create({
    data: {
      organizationId: lead.organizationId,
      websiteId: lead.websiteId,
      leadId: lead.id,
      leadAttributionId: lead.attribution.id,
      attributionTouchId: touch.id,
      googleAdsCustomerId: config.googleAdsCustomerId,
      status: "PENDING",
      resolutionMethod: "UNRESOLVED",
      acquisitionAt: touch.capturedAt,
      nextAttemptAt: new Date(),
    },
  });
}

export async function claimDueClickResolutions(now = new Date()) {
  const due = await database.googleAdsLeadAttributionResolution.findMany({
    where: {
      status: { in: ["PENDING", "ERROR", "NOT_FOUND"] },
      nextAttemptAt: { lte: now },
    },
    distinct: ["googleAdsCustomerId"],
    select: {
      organizationId: true,
      googleAdsCustomerId: true,
    },
    take: 20,
  });
  return due;
}

export async function executeGoogleAdsClickResolution(input: {
  leadId?: string;
  googleAdsCustomerId?: string;
  organizationId: string;
}) {
  if (input.leadId) {
    await ensureLeadClickResolution({
      leadId: input.leadId,
      organizationId: input.organizationId,
    });
  }
  const now = new Date();
  const due = await database.googleAdsLeadAttributionResolution.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: ["PENDING", "ERROR", "NOT_FOUND"] },
      nextAttemptAt: { lte: now },
      ...(input.googleAdsCustomerId
        ? { googleAdsCustomerId: input.googleAdsCustomerId }
        : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
    },
    include: {
      attributionTouch: true,
      customer: { include: { connection: true } },
    },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  if (due.length === 0) return { resolved: 0 };

  const ads = getGoogleAdsConfig();
  const byCustomer = new Map<string, typeof due>();
  for (const row of due) {
    const list = byCustomer.get(row.googleAdsCustomerId) ?? [];
    list.push(row);
    byCustomer.set(row.googleAdsCustomerId, list);
  }

  let resolved = 0;
  for (const rows of byCustomer.values()) {
    const customer = rows[0]?.customer;
    if (!customer) continue;
    const timeZone = customer.timeZone || "UTC";
    const today = todayInTimeZone(now, timeZone);
    const lookbackStart = addIsoDays(today, -(ads.clickViewLookbackDays - 1));
    const gclidRows: Array<
      (typeof rows)[number] & { gclid: string; candidateDate: string }
    > = [];

    for (const row of rows) {
      const touch = row.attributionTouch;
      incrementGoogleAdsAnalyticsMetric("google_ads_click_resolution_total");
      logger.info("google_ads.attribution.resolve_started", {
        organizationId: row.organizationId,
        leadId: row.leadId,
        hasGclid: touch.hasGclid,
        hasGbraid: touch.hasGbraid,
        hasWbraid: touch.hasWbraid,
      });

      if (!touch.hasGclid && (touch.hasGbraid || touch.hasWbraid)) {
        await finalizeResolution(row.id, {
          status: "UNSUPPORTED_IDENTIFIER",
          resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
        });
        incrementGoogleAdsAnalyticsMetric(
          "google_ads_click_resolution_unresolved",
        );
        logger.info("google_ads.attribution.resolved", {
          organizationId: row.organizationId,
          leadId: row.leadId,
          status: "UNSUPPORTED_IDENTIFIER",
        });
        resolved += 1;
        continue;
      }

      if (!touch.hasGclid || !touch.encryptedGclid) {
        await finalizeResolution(row.id, {
          status: "ACCOUNT_RESOLVED",
          resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
        });
        resolved += 1;
        continue;
      }

      const candidateDate = cohortDateForLead({
        acquisitionCapturedAt: touch.capturedAt,
        googleClickDate: null,
        timeZone,
      });
      if (candidateDate < lookbackStart) {
        await finalizeResolution(row.id, {
          status: "OUTSIDE_LOOKBACK",
          resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
        });
        incrementGoogleAdsAnalyticsMetric(
          "google_ads_click_resolution_unresolved",
        );
        logger.info("google_ads.attribution.outside_lookback", {
          organizationId: row.organizationId,
          leadId: row.leadId,
        });
        resolved += 1;
        continue;
      }

      let gclid: string;
      try {
        gclid = decryptClickId(touch.encryptedGclid);
      } catch {
        await markError(row, ads.clickResolveRetryLimit, "DECRYPT_FAILED");
        incrementGoogleAdsAnalyticsMetric("google_ads_click_resolution_failed");
        continue;
      }
      if (!isSafeGaqlGclid(gclid)) {
        await finalizeResolution(row.id, {
          status: "ACCOUNT_RESOLVED",
          resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
          errorCode: "UNSAFE_GCLID",
        });
        incrementGoogleAdsAnalyticsMetric(
          "google_ads_click_resolution_unresolved",
        );
        resolved += 1;
        continue;
      }
      gclidRows.push({ ...row, gclid, candidateDate });
    }

    if (gclidRows.length === 0) continue;
    if (customer.connection.status === "DISCONNECTED") {
      for (const row of gclidRows) {
        await markError(row, ads.clickResolveRetryLimit, "DISCONNECTED");
      }
      continue;
    }

    let session;
    try {
      const accessToken = await refreshGoogleConnectionAccessToken(
        customer.connection,
      );
      session = {
        accessToken,
        developerToken: ads.developerToken || "fake-developer-token",
        loginCustomerId: customer.loginCustomerId,
      };
    } catch (error) {
      const mapped = mapProviderFailure(error);
      for (const row of gclidRows) {
        await markError(row, ads.clickResolveRetryLimit, mapped.code);
        incrementGoogleAdsAnalyticsMetric("google_ads_click_resolution_failed");
      }
      continue;
    }

    const provider = getGoogleAdsReadProvider();
    const byDate = new Map<string, typeof gclidRows>();
    for (const row of gclidRows) {
      const list = byDate.get(row.candidateDate) ?? [];
      list.push(row);
      byDate.set(row.candidateDate, list);
    }

    const found = new Map<string, GoogleAdsClickViewRow[]>();
    try {
      for (const [date, dateRows] of byDate) {
        for (const batch of chunk(dateRows, ads.clickViewBatchSize)) {
          const matches = await provider.getClickViews(
            session,
            customer.googleCustomerId,
            { date, gclids: batch.map((row) => row.gclid) },
          );
          for (const match of matches) {
            const list = found.get(match.gclid) ?? [];
            list.push(match);
            found.set(match.gclid, list);
          }
        }
      }
    } catch (error) {
      const mapped = mapProviderFailure(error);
      for (const row of gclidRows) {
        await markError(row, ads.clickResolveRetryLimit, mapped.code);
        incrementGoogleAdsAnalyticsMetric("google_ads_click_resolution_failed");
      }
      continue;
    }

    const missing = gclidRows.filter((row) => !found.has(row.gclid));
    const nearbyDates = new Set<string>();
    for (const row of missing) {
      const hour = zonedDateHour(
        row.attributionTouch.capturedAt,
        timeZone,
      ).hour;
      if (hour <= 1) nearbyDates.add(addIsoDays(row.candidateDate, -1));
      if (hour >= 22) nearbyDates.add(addIsoDays(row.candidateDate, 1));
    }
    try {
      for (const date of nearbyDates) {
        if (date < lookbackStart || date > today) continue;
        const dateRows = missing.filter((row) => {
          const hour = zonedDateHour(
            row.attributionTouch.capturedAt,
            timeZone,
          ).hour;
          return (
            (hour <= 1 && addIsoDays(row.candidateDate, -1) === date) ||
            (hour >= 22 && addIsoDays(row.candidateDate, 1) === date)
          );
        });
        for (const batch of chunk(dateRows, ads.clickViewBatchSize)) {
          if (batch.length === 0) continue;
          const matches = await provider.getClickViews(
            session,
            customer.googleCustomerId,
            { date, gclids: batch.map((row) => row.gclid) },
          );
          for (const match of matches) {
            const list = found.get(match.gclid) ?? [];
            list.push(match);
            found.set(match.gclid, list);
          }
        }
      }
    } catch (error) {
      const mapped = mapProviderFailure(error);
      for (const row of missing) {
        await markError(row, ads.clickResolveRetryLimit, mapped.code);
        incrementGoogleAdsAnalyticsMetric("google_ads_click_resolution_failed");
      }
      continue;
    }

    for (const row of gclidRows) {
      const matches = found.get(row.gclid) ?? [];
      if (matches.length === 0) {
        const ageDays = daysBetweenIso(row.candidateDate, today);
        if (ageDays >= ads.clickViewLookbackDays) {
          await finalizeResolution(row.id, {
            status: "OUTSIDE_LOOKBACK",
            resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
          });
          logger.info("google_ads.attribution.outside_lookback", {
            organizationId: row.organizationId,
            leadId: row.leadId,
          });
        } else {
          await markNotFound(row, ads);
          logger.info("google_ads.attribution.not_found", {
            organizationId: row.organizationId,
            leadId: row.leadId,
          });
        }
        incrementGoogleAdsAnalyticsMetric(
          "google_ads_click_resolution_unresolved",
        );
        resolved += 1;
        continue;
      }
      const campaignIds = new Set(
        matches.map((match) => match.campaignId).filter(Boolean),
      );
      if (campaignIds.size > 1) {
        await finalizeResolution(row.id, {
          status: "AMBIGUOUS",
          resolutionMethod: "GCLID_CLICK_VIEW",
          googleClickDate: matches[0]?.date ?? null,
        });
        incrementGoogleAdsAnalyticsMetric(
          "google_ads_click_resolution_unresolved",
        );
        resolved += 1;
        continue;
      }
      const match = matches.find((item) => item.campaignId) ?? matches[0]!;
      if (!match.campaignId) {
        await finalizeResolution(row.id, {
          status: "ACCOUNT_RESOLVED",
          resolutionMethod: "GCLID_CLICK_VIEW",
          googleClickDate: match.date,
        });
        incrementGoogleAdsAnalyticsMetric(
          "google_ads_click_resolution_unresolved",
        );
        resolved += 1;
        continue;
      }
      await finalizeResolution(row.id, {
        status: "CAMPAIGN_RESOLVED",
        resolutionMethod: "GCLID_CLICK_VIEW",
        googleClickDate: match.date,
        campaignId: match.campaignId,
        campaignNameSnapshot: match.campaignName,
        adGroupId: match.adGroupId,
        adGroupNameSnapshot: match.adGroupName,
        adId: match.adId,
        keywordCriterionId: match.keywordCriterionId,
        keywordTextSnapshot: match.keywordText,
        keywordMatchType: match.keywordMatchType,
      });
      logger.info("google_ads.attribution.resolved", {
        organizationId: row.organizationId,
        leadId: row.leadId,
        status: "CAMPAIGN_RESOLVED",
        hasCampaign: true,
      });
      resolved += 1;
    }
  }
  return { resolved };
}

async function finalizeResolution(
  id: string,
  data: {
    status: GoogleAdsLeadAttributionResolutionStatus;
    resolutionMethod: GoogleAdsLeadAttributionResolutionMethod;
    googleClickDate?: string | null;
    campaignId?: string | null;
    campaignNameSnapshot?: string | null;
    adGroupId?: string | null;
    adGroupNameSnapshot?: string | null;
    adId?: string | null;
    keywordCriterionId?: string | null;
    keywordTextSnapshot?: string | null;
    keywordMatchType?: string | null;
    errorCode?: string | null;
  },
) {
  await database.googleAdsLeadAttributionResolution.update({
    where: { id },
    data: {
      status: data.status,
      resolutionMethod: data.resolutionMethod,
      googleClickDate: data.googleClickDate
        ? utcDateFromIso(data.googleClickDate)
        : null,
      campaignId: data.campaignId ?? null,
      campaignNameSnapshot: data.campaignNameSnapshot ?? null,
      adGroupId: data.adGroupId ?? null,
      adGroupNameSnapshot: data.adGroupNameSnapshot ?? null,
      adId: data.adId ?? null,
      keywordCriterionId: data.keywordCriterionId ?? null,
      keywordTextSnapshot: data.keywordTextSnapshot ?? null,
      keywordMatchType: data.keywordMatchType ?? null,
      errorCode: data.errorCode ?? null,
      resolvedAt: new Date(),
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
    },
  });
}

async function markNotFound(
  row: { id: string; attemptCount: number },
  ads: ReturnType<typeof getGoogleAdsConfig>,
) {
  const attemptCount = row.attemptCount + 1;
  const terminal = attemptCount >= ads.clickResolveRetryLimit;
  await database.googleAdsLeadAttributionResolution.update({
    where: { id: row.id },
    data: {
      status: "NOT_FOUND",
      resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
      attemptCount,
      lastAttemptAt: new Date(),
      nextAttemptAt: terminal
        ? null
        : new Date(Date.now() + ads.clickResolveRetryDelaySeconds * 1000),
    },
  });
}

async function markError(
  row: { id: string; attemptCount: number },
  retryLimit: number,
  errorCode: string,
) {
  const ads = getGoogleAdsConfig();
  const attemptCount = row.attemptCount + 1;
  const terminal = attemptCount >= retryLimit;
  await database.googleAdsLeadAttributionResolution.update({
    where: { id: row.id },
    data: {
      status: "ERROR",
      resolutionMethod: "WEBSITE_ACCOUNT_MAPPING",
      errorCode,
      attemptCount,
      lastAttemptAt: new Date(),
      nextAttemptAt: terminal
        ? null
        : new Date(Date.now() + ads.clickResolveRetryDelaySeconds * 1000),
    },
  });
}
