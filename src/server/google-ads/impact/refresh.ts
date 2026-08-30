import { Pool, type PoolClient } from "pg";
import type { IncidentOutcome } from "@/server/incidents/engine";
import { getServerEnvironment } from "@/lib/env";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { enqueueGoogleAdsImpact } from "@/jobs/queue";
import type { GoogleAdsImpactJobData } from "@/jobs/queue";
import {
  getGoogleAdsAuthClient,
  getGoogleAdsReadProvider,
  mapProviderFailure,
} from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { decryptSecret } from "@/server/google-ads/encryption";
import { GoogleAdsProviderError } from "@/server/google-ads/errors";
import type {
  GoogleAdsHourlySourceMetric,
  GoogleAdsReadSession,
} from "@/server/google-ads/provider";
import { prepareGoogleAdsDestinationUrl } from "@/server/google-ads/urls";
import {
  calculateIncidentImpact,
  type CalculatorSource,
} from "@/server/google-ads/impact/calculator";
import {
  enumerateZonedDates,
  isValidTimeZone,
} from "@/server/google-ads/impact/timezone";

const logger = createLogger("google-ads-impact");
const impactLockClass = 904_212;
let lockPool: Pool | undefined;

export type GoogleAdsImpactJobReason = GoogleAdsImpactJobData["reason"];

function getLockPool(): Pool {
  lockPool ??= new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 8,
    application_name: "leadguard-google-ads-impact-lock",
  });
  return lockPool;
}

export async function disconnectGoogleAdsImpactLocks(): Promise<void> {
  if (!lockPool) return;
  await lockPool.end();
  lockPool = undefined;
}

async function tryLockImpact(
  client: PoolClient,
  incidentId: string,
): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked",
    [incidentId, impactLockClass],
  );
  return result.rows[0]?.locked === true;
}

async function unlockImpact(
  client: PoolClient,
  incidentId: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1), $2)", [
    incidentId,
    impactLockClass,
  ]);
}

function normalizeReportedUrl(url: string): string | null {
  const prepared = prepareGoogleAdsDestinationUrl(url, "FINAL_URL");
  return prepared.kind === "monitorable" ? prepared.normalizedUrl : null;
}

async function loadReadSession(connection: {
  encryptedRefreshToken: string | null;
}): Promise<GoogleAdsReadSession> {
  const config = getGoogleAdsConfig();
  if (!config.developerToken && config.provider === "google") {
    throw new GoogleAdsProviderError({
      code: "PLATFORM_CONFIG",
      message: "Google Ads is not configured on this LeadGuard environment.",
      platformConfig: true,
    });
  }
  if (!connection.encryptedRefreshToken) {
    throw new GoogleAdsProviderError({
      code: "AUTH_FAILURE",
      message: "Google Ads request failed.",
      authFailure: true,
    });
  }
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const refreshed = await getGoogleAdsAuthClient().refreshAccessToken({
    refreshToken,
    clientId: config.clientId || "fake-client-id",
    clientSecret: config.clientSecret || "fake-client-secret",
  });
  return {
    accessToken: refreshed.accessToken,
    developerToken: config.developerToken || "fake-developer-token",
    loginCustomerId: null,
  };
}

function nextRefreshAt(input: {
  reason: GoogleAdsImpactJobReason;
  incidentStatus: "OPEN" | "RESOLVED";
  resolvedAt: Date | null;
  now: Date;
  finalizedAt: Date | null;
  reconciledAt: Date | null;
}): Date | null {
  const config = getGoogleAdsConfig();
  if (input.incidentStatus === "OPEN") {
    return new Date(
      input.now.getTime() + config.impactRefreshIntervalSeconds * 1000,
    );
  }
  if (!input.finalizedAt) {
    const resolved = input.resolvedAt ?? input.now;
    return new Date(
      resolved.getTime() + config.impactFinalizeDelayMinutes * 60_000,
    );
  }
  if (!input.reconciledAt) {
    return new Date(
      input.finalizedAt.getTime() +
        config.impactReconcileAfterHours * 60 * 60 * 1000,
    );
  }
  return null;
}

export async function scheduleGoogleAdsIncidentImpact(
  monitorId: string,
  outcome: IncidentOutcome,
): Promise<void> {
  if (outcome.kind !== "opened" && outcome.kind !== "resolved") return;
  try {
    const monitor = await database.monitor.findFirst({
      where: { id: monitorId, type: "AD_DESTINATION", deletedAt: null },
      select: { id: true },
    });
    if (!monitor) return;
    if (outcome.kind === "opened") {
      await ensurePendingImpact(outcome.incidentId);
    }
    await enqueueGoogleAdsImpact({
      incidentId: outcome.incidentId,
      reason: outcome.kind === "opened" ? "open" : "finalize",
    });
    if (getGoogleAdsConfig().provider === "fake") {
      await executeGoogleAdsImpactJob({
        incidentId: outcome.incidentId,
        reason: outcome.kind === "opened" ? "open" : "finalize",
      });
    }
  } catch (error) {
    logger.error("google_ads.impact.schedule_failed", {
      monitorId,
      incidentId:
        outcome.kind === "opened" || outcome.kind === "resolved"
          ? outcome.incidentId
          : null,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function ensurePendingImpact(
  incidentId: string,
): Promise<string | null> {
  const incident = await database.incident.findFirst({
    where: { id: incidentId },
    select: {
      id: true,
      startedAt: true,
      resolvedAt: true,
      monitor: {
        select: {
          id: true,
          type: true,
          website: { select: { organizationId: true } },
          googleAdsDestinationTarget: {
            select: {
              id: true,
              googleAdsCustomerId: true,
              customer: { select: { currencyCode: true } },
            },
          },
        },
      },
    },
  });
  const target = incident?.monitor.googleAdsDestinationTarget;
  if (!incident || incident.monitor.type !== "AD_DESTINATION" || !target) {
    return null;
  }
  const existing = await database.googleAdsIncidentImpact.findUnique({
    where: { incidentId },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await database.googleAdsIncidentImpact.create({
    data: {
      organizationId: incident.monitor.website.organizationId,
      incidentId: incident.id,
      monitorId: incident.monitor.id,
      destinationTargetId: target.id,
      googleAdsCustomerId: target.googleAdsCustomerId,
      currencyCode: target.customer.currencyCode || "UNKNOWN",
      windowStartedAt: incident.startedAt,
      windowEndedAt: incident.resolvedAt,
      nextRefreshAt: new Date(),
    },
    select: { id: true },
  });
  logger.info("google_ads.impact.created", {
    incidentId,
    impactId: created.id,
    organizationId: incident.monitor.website.organizationId,
    monitorId: incident.monitor.id,
    targetId: target.id,
    customerId: target.googleAdsCustomerId,
  });
  return created.id;
}

function diagnosticForError(error: GoogleAdsProviderError): string {
  if (error.authFailure) return "REAUTH_REQUIRED";
  if (error.accessLost) return "ACCESS_LOST";
  if (error.platformConfig) return "PLATFORM_CONFIG";
  return error.code;
}

export async function executeGoogleAdsImpactJob(data: GoogleAdsImpactJobData) {
  const client = await getLockPool().connect();
  const locked = await tryLockImpact(client, data.incidentId);
  if (!locked) {
    client.release();
    return "locked";
  }
  try {
    return await refreshIncidentImpact(data);
  } finally {
    await unlockImpact(client, data.incidentId);
    client.release();
  }
}

async function refreshIncidentImpact(data: GoogleAdsImpactJobData) {
  const now = new Date();
  await ensurePendingImpact(data.incidentId);
  const impact = await database.googleAdsIncidentImpact.findUnique({
    where: { incidentId: data.incidentId },
    include: {
      incident: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          resolvedAt: true,
          monitor: { select: { type: true } },
        },
      },
      customer: {
        include: { connection: true },
      },
      target: {
        select: {
          id: true,
          normalizedUrl: true,
          sourceUrl: true,
        },
      },
    },
  });
  if (!impact || impact.incident.monitor.type !== "AD_DESTINATION") {
    return "skipped";
  }

  logger.info("google_ads.impact.refresh_started", {
    organizationId: impact.organizationId,
    incidentId: impact.incidentId,
    monitorId: impact.monitorId,
    customerId: impact.customer.googleCustomerId,
    targetId: impact.destinationTargetId,
    impactId: impact.id,
    reason: data.reason,
  });

  const windowStartedAt = impact.incident.startedAt;
  const windowEndedAt =
    impact.incident.status === "RESOLVED"
      ? (impact.incident.resolvedAt ?? now)
      : now;
  const isProvisional =
    impact.incident.status === "OPEN" ||
    (data.reason !== "reconcile" && !impact.finalizedAt);

  if (impact.customer.connection.status === "DISCONNECTED") {
    await database.googleAdsIncidentImpact.update({
      where: { id: impact.id },
      data: {
        dataIncomplete: true,
        diagnosticCode: "DISCONNECTED",
        nextRefreshAt: null,
        windowStartedAt,
        windowEndedAt: impact.incident.resolvedAt,
        isProvisional,
      },
    });
    logger.info("google_ads.impact.unavailable", {
      organizationId: impact.organizationId,
      incidentId: impact.incidentId,
      monitorId: impact.monitorId,
      customerId: impact.customer.googleCustomerId,
      targetId: impact.destinationTargetId,
      impactId: impact.id,
      attributionMethod: "UNAVAILABLE",
      confidence: "UNAVAILABLE",
    });
    return "disconnected";
  }

  if (impact.customer.connection.status === "REAUTH_REQUIRED") {
    await persistUnavailable(impact.id, {
      windowStartedAt,
      windowEndedAt,
      isProvisional,
      diagnosticCode: "REAUTH_REQUIRED",
      now,
      reason: data.reason,
      incidentStatus: impact.incident.status,
      resolvedAt: impact.incident.resolvedAt,
      finalizedAt: impact.finalizedAt,
      reconciledAt: impact.reconciledAt,
    });
    return "reauth";
  }

  const timeZone = impact.customer.timeZone;
  if (!timeZone || !isValidTimeZone(timeZone)) {
    await persistUnavailable(impact.id, {
      windowStartedAt,
      windowEndedAt,
      isProvisional,
      diagnosticCode: "INVALID_TIMEZONE",
      now,
      reason: data.reason,
      incidentStatus: impact.incident.status,
      resolvedAt: impact.incident.resolvedAt,
      finalizedAt: impact.finalizedAt,
      reconciledAt: impact.reconciledAt,
      currencyCode: impact.customer.currencyCode,
    });
    return "invalid_timezone";
  }

  const currencyCode = impact.customer.currencyCode;
  if (!currencyCode) {
    await persistUnavailable(impact.id, {
      windowStartedAt,
      windowEndedAt,
      isProvisional,
      diagnosticCode: "MISSING_CURRENCY",
      now,
      reason: data.reason,
      incidentStatus: impact.incident.status,
      resolvedAt: impact.incident.resolvedAt,
      finalizedAt: impact.finalizedAt,
      reconciledAt: impact.reconciledAt,
    });
    return "missing_currency";
  }

  const dates = enumerateZonedDates(windowStartedAt, windowEndedAt, timeZone);
  const fromDate = dates[0];
  const toDate = dates[dates.length - 1];
  if (!fromDate || !toDate) {
    await persistUnavailable(impact.id, {
      windowStartedAt,
      windowEndedAt,
      isProvisional,
      diagnosticCode: "EMPTY_WINDOW",
      now,
      reason: data.reason,
      incidentStatus: impact.incident.status,
      resolvedAt: impact.incident.resolvedAt,
      finalizedAt: impact.finalizedAt,
      reconciledAt: impact.reconciledAt,
      currencyCode,
    });
    return "empty_window";
  }

  const config = getGoogleAdsConfig();
  const hourlyFloor = new Date(
    now.getTime() - config.impactHourlyLookbackDays * 24 * 60 * 60 * 1000,
  );
  const hourlyEligible = windowStartedAt >= hourlyFloor;

  const references = await database.googleAdsDestinationReference.findMany({
    where: { googleAdsCustomerId: impact.googleAdsCustomerId },
    select: {
      targetId: true,
      sourceType: true,
      adId: true,
      assetGroupId: true,
      campaignId: true,
      campaignName: true,
      adGroupId: true,
      landingPageSource: true,
      target: { select: { id: true, normalizedUrl: true } },
    },
  });

  const sources = buildCalculatorSources(
    references,
    impact.destinationTargetId,
    impact.target.normalizedUrl,
  );

  try {
    const session = await loadReadSession(impact.customer.connection);
    session.loginCustomerId = impact.customer.loginCustomerId;
    const provider = getGoogleAdsReadProvider();
    const adIds = sources
      .filter((item) => item.sourceType === "AD_GROUP_AD")
      .map((item) => item.sourceEntityId);

    const [hourlyAds, daily, expanded] = await Promise.all([
      hourlyEligible && adIds.length
        ? provider.getAdHourlyMetrics(
            session,
            impact.customer.googleCustomerId,
            {
              adIds,
              fromDate,
              toDate,
            },
          )
        : Promise.resolve([] as GoogleAdsHourlySourceMetric[]),
      provider.getLandingPageDailyMetrics(
        session,
        impact.customer.googleCustomerId,
        { fromDate, toDate },
      ),
      provider.getExpandedLandingPageDailyMetrics(
        session,
        impact.customer.googleCustomerId,
        { fromDate, toDate },
      ),
    ]);

    const calculated = calculateIncidentImpact({
      windowStartedAt,
      windowEndedAt,
      timeZone,
      destinationNormalizedUrl: impact.target.normalizedUrl,
      sources,
      hourlyBuckets: hourlyAds.map((row) => ({
        sourceType: row.sourceType,
        sourceEntityId: row.sourceEntityId,
        date: row.date,
        hour: row.hour,
        clicks: row.clicks,
        costMicros: row.costMicros,
        impressions: row.impressions,
      })),
      dailyLandingPages: [...daily, ...expanded]
        .map((row) => {
          const normalizedUrl = normalizeReportedUrl(row.url);
          if (!normalizedUrl) return null;
          return {
            normalizedUrl,
            date: row.date,
            clicks: row.clicks,
            costMicros: row.costMicros,
            impressions: row.impressions,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    });

    const finalized =
      data.reason === "finalize" &&
      impact.incident.status === "RESOLVED" &&
      Boolean(impact.incident.resolvedAt) &&
      now.getTime() - (impact.incident.resolvedAt?.getTime() ?? 0) >=
        config.impactFinalizeDelayMinutes * 60_000;
    const reconciled =
      data.reason === "reconcile" && Boolean(impact.finalizedAt);

    await database.$transaction([
      database.googleAdsIncidentImpactSource.deleteMany({
        where: { impactId: impact.id },
      }),
      database.googleAdsIncidentImpact.update({
        where: { id: impact.id },
        data: {
          status: calculated.status,
          attributionMethod: calculated.attributionMethod,
          confidence: calculated.confidence,
          isProvisional: reconciled || finalized ? false : isProvisional,
          dataIncomplete: false,
          currencyCode,
          windowStartedAt,
          windowEndedAt,
          windowCostMicros: calculated.windowCostMicros,
          windowClicksMilli: calculated.windowClicksMilli,
          windowClicksEstimated: calculated.windowClicksEstimated,
          windowImpressions: calculated.windowImpressions,
          destinationDailyCostMicros: calculated.destinationDailyCostMicros,
          destinationDailyClicks: calculated.destinationDailyClicks,
          destinationDailyImpressions: calculated.destinationDailyImpressions,
          destinationDailyFrom: calculated.destinationDailyFrom,
          destinationDailyTo: calculated.destinationDailyTo,
          totalRelevantSources: calculated.totalRelevantSources,
          attributedSources: calculated.attributedSources,
          ambiguousSources: calculated.ambiguousSources,
          dataFrom: calculated.dataFrom,
          dataThrough: calculated.dataThrough,
          lastRefreshedAt: now,
          lastManualRefreshAt:
            data.reason === "manual" ? now : impact.lastManualRefreshAt,
          finalizedAt: finalized || reconciled ? now : impact.finalizedAt,
          reconciledAt: reconciled ? now : impact.reconciledAt,
          diagnosticCode: null,
          nextRefreshAt: nextRefreshAt({
            reason: data.reason,
            incidentStatus: impact.incident.status,
            resolvedAt: impact.incident.resolvedAt,
            now,
            finalizedAt: finalized || reconciled ? now : impact.finalizedAt,
            reconciledAt: reconciled ? now : impact.reconciledAt,
          }),
          sources: {
            create: calculated.sources.map((source) => ({
              sourceType: source.sourceType,
              sourceEntityId: source.sourceEntityId,
              campaignId: source.campaignId,
              campaignName: source.campaignName,
              adGroupId: source.adGroupId,
              adId: source.adId,
              assetGroupId: source.assetGroupId,
              coverageStatus: source.coverageStatus,
              method: source.method,
              confidence: source.confidence,
              costMicros: source.costMicros,
              clicksMilli: source.clicksMilli,
              impressions: source.impressions,
            })),
          },
        },
      }),
    ]);

    logger.info(
      calculated.status === "PARTIAL"
        ? "google_ads.impact.partial"
        : calculated.status === "UNAVAILABLE"
          ? "google_ads.impact.unavailable"
          : finalized || reconciled
            ? "google_ads.impact.finalized"
            : "google_ads.impact.refresh_completed",
      {
        organizationId: impact.organizationId,
        incidentId: impact.incidentId,
        monitorId: impact.monitorId,
        customerId: impact.customer.googleCustomerId,
        targetId: impact.destinationTargetId,
        impactId: impact.id,
        attributionMethod: calculated.attributionMethod,
        confidence: calculated.confidence,
      },
    );
    return calculated.status;
  } catch (error) {
    const mapped = mapProviderFailure(error);
    if (mapped.authFailure) {
      await database.googleAdsConnection.update({
        where: { id: impact.customer.connectionId },
        data: { status: "REAUTH_REQUIRED", lastSyncErrorCode: mapped.code },
      });
    }
    await persistUnavailable(impact.id, {
      windowStartedAt,
      windowEndedAt,
      isProvisional,
      diagnosticCode: diagnosticForError(mapped),
      now,
      reason: data.reason,
      incidentStatus: impact.incident.status,
      resolvedAt: impact.incident.resolvedAt,
      finalizedAt: impact.finalizedAt,
      reconciledAt: impact.reconciledAt,
      currencyCode,
      status: "ERROR",
    });
    logger.error("google_ads.impact.refresh_failed", {
      organizationId: impact.organizationId,
      incidentId: impact.incidentId,
      monitorId: impact.monitorId,
      customerId: impact.customer.googleCustomerId,
      targetId: impact.destinationTargetId,
      impactId: impact.id,
      message: mapped.message,
    });
    return "error";
  }
}

async function persistUnavailable(
  impactId: string,
  input: {
    windowStartedAt: Date;
    windowEndedAt: Date;
    isProvisional: boolean;
    diagnosticCode: string;
    now: Date;
    reason: GoogleAdsImpactJobReason;
    incidentStatus: "OPEN" | "RESOLVED";
    resolvedAt: Date | null;
    finalizedAt: Date | null;
    reconciledAt: Date | null;
    currencyCode?: string | null;
    status?: "UNAVAILABLE" | "ERROR";
  },
) {
  await database.googleAdsIncidentImpact.update({
    where: { id: impactId },
    data: {
      status: input.status ?? "UNAVAILABLE",
      attributionMethod: "UNAVAILABLE",
      confidence: "UNAVAILABLE",
      isProvisional: input.isProvisional,
      windowStartedAt: input.windowStartedAt,
      windowEndedAt: input.windowEndedAt,
      windowCostMicros: null,
      windowClicksMilli: null,
      lastRefreshedAt: input.now,
      lastManualRefreshAt: input.reason === "manual" ? input.now : undefined,
      diagnosticCode: input.diagnosticCode,
      ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
      nextRefreshAt: nextRefreshAt({
        reason: input.reason,
        incidentStatus: input.incidentStatus,
        resolvedAt: input.resolvedAt,
        now: input.now,
        finalizedAt: input.finalizedAt,
        reconciledAt: input.reconciledAt,
      }),
    },
  });
}

function buildCalculatorSources(
  references: Array<{
    targetId: string;
    sourceType: "AD_GROUP_AD" | "ASSET_GROUP" | "EXPANDED_LANDING_PAGE";
    adId: string | null;
    assetGroupId: string | null;
    campaignId: string;
    campaignName: string;
    adGroupId: string | null;
    landingPageSource: string | null;
    target: { id: string; normalizedUrl: string };
  }>,
  destinationTargetId: string,
  destinationNormalizedUrl: string,
): CalculatorSource[] {
  const urlsByAd = new Map<string, Set<string>>();
  const urlsByAsset = new Map<string, Set<string>>();
  const expansionByAsset = new Set<string>();
  for (const reference of references) {
    if (reference.sourceType === "AD_GROUP_AD" && reference.adId) {
      const set = urlsByAd.get(reference.adId) ?? new Set();
      set.add(reference.target.normalizedUrl);
      urlsByAd.set(reference.adId, set);
    }
    if (reference.sourceType === "ASSET_GROUP" && reference.assetGroupId) {
      const set = urlsByAsset.get(reference.assetGroupId) ?? new Set();
      set.add(reference.target.normalizedUrl);
      urlsByAsset.set(reference.assetGroupId, set);
    }
    if (
      reference.sourceType === "EXPANDED_LANDING_PAGE" &&
      reference.landingPageSource === "URL_EXPANSION" &&
      reference.target.normalizedUrl !== destinationNormalizedUrl
    ) {
      expansionByAsset.add(reference.campaignId);
    }
  }

  const seen = new Set<string>();
  const sources: CalculatorSource[] = [];
  for (const reference of references) {
    if (reference.targetId !== destinationTargetId) continue;
    if (reference.sourceType === "AD_GROUP_AD" && reference.adId) {
      const key = `AD_GROUP_AD:${reference.adId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        sourceType: "AD_GROUP_AD",
        sourceEntityId: reference.adId,
        campaignId: reference.campaignId,
        campaignName: reference.campaignName,
        adGroupId: reference.adGroupId,
        adId: reference.adId,
        assetGroupId: null,
        uniqueNormalizedFinalUrls: [...(urlsByAd.get(reference.adId) ?? [])],
        hasUrlExpansionToOtherDestination: false,
      });
    }
    if (reference.sourceType === "ASSET_GROUP" && reference.assetGroupId) {
      const key = `ASSET_GROUP:${reference.assetGroupId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        sourceType: "ASSET_GROUP",
        sourceEntityId: reference.assetGroupId,
        campaignId: reference.campaignId,
        campaignName: reference.campaignName,
        adGroupId: null,
        adId: null,
        assetGroupId: reference.assetGroupId,
        uniqueNormalizedFinalUrls: [
          ...(urlsByAsset.get(reference.assetGroupId) ?? []),
        ],
        hasUrlExpansionToOtherDestination: expansionByAsset.has(
          reference.campaignId,
        ),
      });
    }
  }
  return sources;
}

export async function claimDueGoogleAdsImpacts(
  now = new Date(),
  batchSize = getGoogleAdsConfig().schedulerBatchSize,
) {
  return database.$transaction(async (tx) => {
    const due = await tx.googleAdsIncidentImpact.findMany({
      where: {
        dataIncomplete: false,
        nextRefreshAt: { lte: now },
        customer: {
          connection: { status: { in: ["CONNECTED", "REAUTH_REQUIRED"] } },
        },
      },
      orderBy: { nextRefreshAt: "asc" },
      take: batchSize,
      select: {
        incidentId: true,
        incident: { select: { status: true, resolvedAt: true } },
        finalizedAt: true,
        reconciledAt: true,
      },
    });
    const bumped = await Promise.all(
      due.map(async (row) => {
        await tx.googleAdsIncidentImpact.update({
          where: { incidentId: row.incidentId },
          data: {
            nextRefreshAt: new Date(now.getTime() + 60_000),
          },
        });
        const reason: GoogleAdsImpactJobReason =
          row.incident.status === "OPEN"
            ? "refresh"
            : row.finalizedAt && !row.reconciledAt
              ? "reconcile"
              : "finalize";
        return { incidentId: row.incidentId, reason };
      }),
    );
    return bumped;
  });
}
