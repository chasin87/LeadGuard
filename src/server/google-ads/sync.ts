import { Pool, type PoolClient } from "pg";
import { Prisma } from "@/generated/prisma/client";
import type {
  GoogleAdsDestinationUrlType,
  GoogleAdsSourceType,
  GoogleAdsUrlProvenance,
} from "@/generated/prisma/enums";
import { createHash } from "node:crypto";
import { getServerEnvironment } from "@/lib/env";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { getMonitoringConfig } from "@/server/monitoring/config";
import {
  isObservedSourceActive,
  isPerformanceMaxSourceActive,
  isStandardAdSourceActive,
} from "@/server/google-ads/active";
import {
  getGoogleAdsAuthClient,
  getGoogleAdsReadProvider,
  mapProviderFailure,
} from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { decryptSecret } from "@/server/google-ads/encryption";
import { GoogleAdsProviderError } from "@/server/google-ads/errors";
import { normalizeGoogleCustomerId } from "@/server/google-ads/ids";
import type {
  GoogleAdsObservedLandingPage,
  GoogleAdsPerformanceMaxDestination,
  GoogleAdsReadSession,
  GoogleAdsStandardAdDestination,
} from "@/server/google-ads/provider";
import { prepareGoogleAdsDestinationUrl } from "@/server/google-ads/urls";

const logger = createLogger("google-ads");
const syncLockClass = 904_211;
let lockPool: Pool | undefined;

function getLockPool(): Pool {
  lockPool ??= new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 8,
    application_name: "leadguard-google-ads-lock",
  });
  return lockPool;
}

export async function disconnectGoogleAdsSyncLocks(): Promise<void> {
  if (!lockPool) return;
  await lockPool.end();
  lockPool = undefined;
}

async function tryLockCustomer(
  client: PoolClient,
  customerRecordId: string,
): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked",
    [customerRecordId, syncLockClass],
  );
  return result.rows[0]?.locked === true;
}

async function unlockCustomer(
  client: PoolClient,
  customerRecordId: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1), $2)", [
    customerRecordId,
    syncLockClass,
  ]);
}

type DiscoveredSource = {
  sourceUrl: string;
  urlType: GoogleAdsDestinationUrlType;
  provenance: GoogleAdsUrlProvenance;
  sourceType: GoogleAdsSourceType;
  sourceEntityKey: string;
  sourceActive: boolean;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  advertisingChannelType: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  adGroupStatus: string | null;
  adId: string | null;
  adStatus: string | null;
  adPrimaryStatus: string | null;
  adType: string | null;
  assetGroupId: string | null;
  assetGroupName: string | null;
  assetGroupStatus: string | null;
  assetGroupPrimaryStatus: string | null;
  landingPageSource: string | null;
};

function lookbackRange(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const stamp = (value: Date) => value.toISOString().slice(0, 10);
  return { fromDate: stamp(from), toDate: stamp(to) };
}

async function loadReadSession(connection: {
  encryptedRefreshToken: string | null;
  status: string;
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

async function persistSource(
  input: {
    organizationId: string;
    customerId: string;
    generation: bigint;
    now: Date;
    websites: Array<{
      id: string;
      normalizedUrl: string;
      status: "ACTIVE" | "DISABLED";
    }>;
  },
  source: DiscoveredSource,
): Promise<"destination" | "unsupported" | "blocked"> {
  const prepared = prepareGoogleAdsDestinationUrl(
    source.sourceUrl,
    source.urlType,
  );
  if (prepared.kind !== "monitorable") {
    const normalizedUrl = `${prepared.approvalStatus.toLowerCase()}:${createHash("sha256").update(source.sourceUrl).digest("hex")}`;
    const target = await database.googleAdsDestinationTarget.upsert({
      where: {
        googleAdsCustomerId_normalizedUrl: {
          googleAdsCustomerId: input.customerId,
          normalizedUrl,
        },
      },
      update: { lastSeenAt: input.now, sourceUrl: source.sourceUrl },
      create: {
        organizationId: input.organizationId,
        googleAdsCustomerId: input.customerId,
        sourceUrl: source.sourceUrl,
        monitoringUrl: null,
        normalizedUrl,
        urlType: source.urlType,
        approvalStatus: prepared.approvalStatus,
        hasActiveSource: false,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
      },
      select: { id: true },
    });
    await upsertReference(
      target.id,
      input.customerId,
      input.generation,
      input.now,
      {
        ...source,
        sourceActive: false,
      },
    );
    return prepared.kind === "blocked" ? "blocked" : "unsupported";
  }

  const website =
    input.websites.find((item) => item.normalizedUrl === prepared.origin) ??
    null;
  const uniqueKey = prepared.normalizedUrl;

  const created = await database.googleAdsDestinationTarget.upsert({
    where: {
      googleAdsCustomerId_normalizedUrl: {
        googleAdsCustomerId: input.customerId,
        normalizedUrl: uniqueKey,
      },
    },
    update: {
      lastSeenAt: input.now,
      sourceUrl: prepared.sourceUrl,
      monitoringUrl: prepared.monitoringUrl,
    },
    create: {
      organizationId: input.organizationId,
      googleAdsCustomerId: input.customerId,
      sourceUrl: prepared.sourceUrl,
      monitoringUrl: prepared.monitoringUrl,
      normalizedUrl: uniqueKey,
      urlType: prepared.urlType,
      websiteId: website?.id ?? null,
      approvalStatus: website ? "APPROVED" : "NEEDS_APPROVAL",
      hasActiveSource: false,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
    },
    select: {
      id: true,
      approvalStatus: true,
      websiteId: true,
    },
  });

  if (created.approvalStatus === "IGNORED") {
    await upsertReference(
      created.id,
      input.customerId,
      input.generation,
      input.now,
      source,
    );
    return "destination";
  }

  const nextApproval =
    created.approvalStatus === "UNSUPPORTED" ||
    created.approvalStatus === "BLOCKED"
      ? created.approvalStatus
      : website
        ? "APPROVED"
        : created.approvalStatus === "APPROVED"
          ? "APPROVED"
          : "NEEDS_APPROVAL";

  if (
    created.websiteId !== (website?.id ?? null) ||
    created.approvalStatus !== nextApproval
  ) {
    await database.googleAdsDestinationTarget.update({
      where: { id: created.id },
      data: {
        websiteId: website?.id ?? created.websiteId,
        approvalStatus: nextApproval,
      },
    });
  }

  await upsertReference(
    created.id,
    input.customerId,
    input.generation,
    input.now,
    source,
  );
  logger.info("google_ads.destination.discovered", {
    organizationId: input.organizationId,
    customerId: input.customerId,
    targetId: created.id,
  });
  return "destination";
}

async function upsertReference(
  targetId: string,
  customerId: string,
  generation: bigint,
  now: Date,
  source: DiscoveredSource,
) {
  await database.googleAdsDestinationReference.upsert({
    where: {
      targetId_sourceType_sourceEntityKey: {
        targetId,
        sourceType: source.sourceType,
        sourceEntityKey: source.sourceEntityKey,
      },
    },
    update: {
      provenance: source.provenance,
      campaignId: source.campaignId,
      campaignName: source.campaignName,
      campaignStatus: source.campaignStatus,
      advertisingChannelType: source.advertisingChannelType,
      adGroupId: source.adGroupId,
      adGroupName: source.adGroupName,
      adGroupStatus: source.adGroupStatus,
      adId: source.adId,
      adStatus: source.adStatus,
      adPrimaryStatus: source.adPrimaryStatus,
      adType: source.adType,
      assetGroupId: source.assetGroupId,
      assetGroupName: source.assetGroupName,
      assetGroupStatus: source.assetGroupStatus,
      assetGroupPrimaryStatus: source.assetGroupPrimaryStatus,
      landingPageSource: source.landingPageSource,
      sourceActive: source.sourceActive,
      lastSyncGeneration: generation,
      lastSeenAt: now,
    },
    create: {
      targetId,
      googleAdsCustomerId: customerId,
      sourceType: source.sourceType,
      sourceEntityKey: source.sourceEntityKey,
      provenance: source.provenance,
      campaignId: source.campaignId,
      campaignName: source.campaignName,
      campaignStatus: source.campaignStatus,
      advertisingChannelType: source.advertisingChannelType,
      adGroupId: source.adGroupId,
      adGroupName: source.adGroupName,
      adGroupStatus: source.adGroupStatus,
      adId: source.adId,
      adStatus: source.adStatus,
      adPrimaryStatus: source.adPrimaryStatus,
      adType: source.adType,
      assetGroupId: source.assetGroupId,
      assetGroupName: source.assetGroupName,
      assetGroupStatus: source.assetGroupStatus,
      assetGroupPrimaryStatus: source.assetGroupPrimaryStatus,
      landingPageSource: source.landingPageSource,
      sourceActive: source.sourceActive,
      lastSyncGeneration: generation,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
}

export async function reconcileDestinationMonitor(targetId: string) {
  const target = await database.googleAdsDestinationTarget.findUnique({
    where: { id: targetId },
    include: {
      website: { select: { id: true, status: true, hostname: true } },
      adDestinationConfig: { select: { userPaused: true, monitorId: true } },
      monitor: { select: { id: true, status: true, deletedAt: true } },
    },
  });
  if (
    !target ||
    !target.monitoringUrl ||
    target.approvalStatus !== "APPROVED"
  ) {
    return;
  }
  if (!target.website || target.website.status !== "ACTIVE") {
    if (target.monitorId && !target.adDestinationConfig?.userPaused) {
      await database.monitor.updateMany({
        where: { id: target.monitorId, deletedAt: null },
        data: { status: "PAUSED" },
      });
    }
    return;
  }

  const activeCount = await database.googleAdsDestinationReference.count({
    where: { targetId: target.id, sourceActive: true },
  });
  const hasActiveSource = activeCount > 0;
  await database.googleAdsDestinationTarget.update({
    where: { id: target.id },
    data: { hasActiveSource },
  });

  const userPaused = target.adDestinationConfig?.userPaused ?? false;
  const shouldSchedule = hasActiveSource && !userPaused;
  const config = getMonitoringConfig();
  const name = `Ad destination · ${new URL(target.monitoringUrl).pathname || "/"}`;

  if (!target.monitorId || target.monitor?.deletedAt) {
    if (!shouldSchedule) return;
    try {
      const monitor = await database.monitor.create({
        data: {
          websiteId: target.website.id,
          name: name.slice(0, 80),
          type: "AD_DESTINATION",
          url: target.monitoringUrl,
          normalizedUrl: target.normalizedUrl,
          intervalSeconds: config.defaultIntervalSeconds,
          timeoutMs: config.defaultTimeoutMs,
          consecutiveFailuresBeforeIncident: config.defaultIncidentThreshold,
          status: "ACTIVE",
          nextCheckAt: new Date(),
          adDestinationConfig: {
            create: {
              destinationTargetId: target.id,
              userPaused: false,
            },
          },
        },
        select: { id: true },
      });
      await database.googleAdsDestinationTarget.update({
        where: { id: target.id },
        data: { monitorId: monitor.id, websiteId: target.website.id },
      });
      logger.info("google_ads.destination.monitor_created", {
        organizationId: target.organizationId,
        targetId: target.id,
        monitorId: monitor.id,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await database.monitor.findFirst({
          where: {
            websiteId: target.website.id,
            type: "AD_DESTINATION",
            normalizedUrl: target.normalizedUrl,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          await database.googleAdsDestinationTarget.update({
            where: { id: target.id },
            data: { monitorId: existing.id },
          });
          await database.adDestinationConfig.upsert({
            where: { monitorId: existing.id },
            update: { destinationTargetId: target.id },
            create: {
              monitorId: existing.id,
              destinationTargetId: target.id,
              userPaused: false,
            },
          });
        }
        return;
      }
      throw error;
    }
    return;
  }

  if (userPaused) return;
  await database.monitor.updateMany({
    where: { id: target.monitorId, deletedAt: null },
    data: {
      status: shouldSchedule ? "ACTIVE" : "PAUSED",
      nextCheckAt: shouldSchedule ? new Date() : undefined,
    },
  });
  if (!hasActiveSource) {
    logger.info("google_ads.destination.source_inactive", {
      organizationId: target.organizationId,
      targetId: target.id,
      monitorId: target.monitorId,
    });
  }
}

async function recomputeCustomerTargets(customerId: string) {
  const targets = await database.googleAdsDestinationTarget.findMany({
    where: { googleAdsCustomerId: customerId },
    select: { id: true },
  });
  for (const target of targets) {
    const activeCount = await database.googleAdsDestinationReference.count({
      where: { targetId: target.id, sourceActive: true },
    });
    await database.googleAdsDestinationTarget.update({
      where: { id: target.id },
      data: { hasActiveSource: activeCount > 0 },
    });
    await reconcileDestinationMonitor(target.id);
  }
}

function sourcesFromStandardAd(
  ad: GoogleAdsStandardAdDestination,
): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const active = isStandardAdSourceActive(ad);
  ad.finalUrls.forEach((url, index) => {
    sources.push({
      sourceUrl: url,
      urlType: "FINAL_URL",
      provenance: "CONFIGURED_FINAL_URL",
      sourceType: "AD_GROUP_AD",
      sourceEntityKey: `ad:${ad.adId}:final:${index}`,
      sourceActive: active,
      campaignId: ad.campaignId,
      campaignName: ad.campaignName,
      campaignStatus: ad.campaignStatus,
      advertisingChannelType: ad.advertisingChannelType,
      adGroupId: ad.adGroupId,
      adGroupName: ad.adGroupName,
      adGroupStatus: ad.adGroupStatus,
      adId: ad.adId,
      adStatus: ad.adStatus,
      adPrimaryStatus: ad.adPrimaryStatus,
      adType: ad.adType,
      assetGroupId: null,
      assetGroupName: null,
      assetGroupStatus: null,
      assetGroupPrimaryStatus: null,
      landingPageSource: null,
    });
  });
  ad.finalMobileUrls.forEach((url, index) => {
    sources.push({
      sourceUrl: url,
      urlType: "MOBILE_FINAL_URL",
      provenance: "CONFIGURED_MOBILE_URL",
      sourceType: "AD_GROUP_AD",
      sourceEntityKey: `ad:${ad.adId}:mobile:${index}`,
      sourceActive: active,
      campaignId: ad.campaignId,
      campaignName: ad.campaignName,
      campaignStatus: ad.campaignStatus,
      advertisingChannelType: ad.advertisingChannelType,
      adGroupId: ad.adGroupId,
      adGroupName: ad.adGroupName,
      adGroupStatus: ad.adGroupStatus,
      adId: ad.adId,
      adStatus: ad.adStatus,
      adPrimaryStatus: ad.adPrimaryStatus,
      adType: ad.adType,
      assetGroupId: null,
      assetGroupName: null,
      assetGroupStatus: null,
      assetGroupPrimaryStatus: null,
      landingPageSource: null,
    });
  });
  return sources;
}

function sourcesFromPerformanceMax(
  group: GoogleAdsPerformanceMaxDestination,
): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const active = isPerformanceMaxSourceActive(group);
  group.finalUrls.forEach((url, index) => {
    sources.push({
      sourceUrl: url,
      urlType: "FINAL_URL",
      provenance: "CONFIGURED_FINAL_URL",
      sourceType: "ASSET_GROUP",
      sourceEntityKey: `asset:${group.assetGroupId}:final:${index}`,
      sourceActive: active,
      campaignId: group.campaignId,
      campaignName: group.campaignName,
      campaignStatus: group.campaignStatus,
      advertisingChannelType: group.advertisingChannelType,
      adGroupId: null,
      adGroupName: null,
      adGroupStatus: null,
      adId: null,
      adStatus: null,
      adPrimaryStatus: null,
      adType: null,
      assetGroupId: group.assetGroupId,
      assetGroupName: group.assetGroupName,
      assetGroupStatus: group.assetGroupStatus,
      assetGroupPrimaryStatus: group.assetGroupPrimaryStatus,
      landingPageSource: null,
    });
  });
  group.finalMobileUrls.forEach((url, index) => {
    sources.push({
      sourceUrl: url,
      urlType: "MOBILE_FINAL_URL",
      provenance: "CONFIGURED_MOBILE_URL",
      sourceType: "ASSET_GROUP",
      sourceEntityKey: `asset:${group.assetGroupId}:mobile:${index}`,
      sourceActive: active,
      campaignId: group.campaignId,
      campaignName: group.campaignName,
      campaignStatus: group.campaignStatus,
      advertisingChannelType: group.advertisingChannelType,
      adGroupId: null,
      adGroupName: null,
      adGroupStatus: null,
      adId: null,
      adStatus: null,
      adPrimaryStatus: null,
      adType: null,
      assetGroupId: group.assetGroupId,
      assetGroupName: group.assetGroupName,
      assetGroupStatus: group.assetGroupStatus,
      assetGroupPrimaryStatus: group.assetGroupPrimaryStatus,
      landingPageSource: null,
    });
  });
  return sources;
}

function sourceFromObserved(
  page: GoogleAdsObservedLandingPage,
): DiscoveredSource {
  return {
    sourceUrl: page.expandedFinalUrl,
    urlType: "OBSERVED_EXPANDED_URL",
    provenance: "OBSERVED_EXPANDED_URL",
    sourceType: "EXPANDED_LANDING_PAGE",
    sourceEntityKey: `observed:${page.campaignId}:${page.expandedFinalUrl}`,
    sourceActive: isObservedSourceActive(page.campaignStatus),
    campaignId: page.campaignId,
    campaignName: page.campaignName,
    campaignStatus: page.campaignStatus,
    advertisingChannelType: null,
    adGroupId: null,
    adGroupName: null,
    adGroupStatus: null,
    adId: null,
    adStatus: null,
    adPrimaryStatus: null,
    adType: null,
    assetGroupId: null,
    assetGroupName: null,
    assetGroupStatus: null,
    assetGroupPrimaryStatus: null,
    landingPageSource: page.landingPageSource,
  };
}

export async function executeGoogleAdsSyncJob(input: {
  connectionId: string;
  googleAdsCustomerId: string;
}): Promise<"skipped" | "completed" | "failed"> {
  const googleCustomerId = normalizeGoogleCustomerId(input.googleAdsCustomerId);
  const customer = await database.googleAdsCustomer.findFirst({
    where: {
      connectionId: input.connectionId,
      googleCustomerId,
    },
    include: { connection: true },
  });
  if (
    !customer ||
    !customer.selected ||
    customer.isManager ||
    customer.status === "DISABLED" ||
    customer.connection.status === "DISCONNECTED"
  ) {
    return "skipped";
  }

  const client = await getLockPool().connect();
  let locked = false;
  const now = new Date();
  let syncRunId: string | null = null;
  try {
    locked = await tryLockCustomer(client, customer.id);
    if (!locked) {
      logger.info("google_ads.sync.locked", {
        organizationId: customer.organizationId,
        connectionId: customer.connectionId,
        customerId: customer.id,
      });
      return "skipped";
    }

    const generation = customer.syncGeneration + 1n;
    const run = await database.googleAdsSyncRun.create({
      data: {
        organizationId: customer.organizationId,
        customerId: customer.id,
        status: "RUNNING",
        startedAt: now,
      },
    });
    syncRunId = run.id;
    await database.googleAdsCustomer.update({
      where: { id: customer.id },
      data: { lastSyncAttemptAt: now, syncGeneration: generation },
    });
    await database.googleAdsConnection.update({
      where: { id: customer.connectionId },
      data: { lastSyncAttemptAt: now },
    });
    logger.info("google_ads.sync.started", {
      organizationId: customer.organizationId,
      connectionId: customer.connectionId,
      customerId: customer.id,
      syncRunId: run.id,
    });

    const session = await loadReadSession(customer.connection);
    session.loginCustomerId = customer.loginCustomerId;
    const provider = getGoogleAdsReadProvider();
    const config = getGoogleAdsConfig();
    const websites = await database.website.findMany({
      where: { organizationId: customer.organizationId },
      select: { id: true, normalizedUrl: true, status: true },
    });
    const persistContext = {
      organizationId: customer.organizationId,
      customerId: customer.id,
      generation,
      now,
      websites,
    };

    let itemsSeen = 0;
    let unsupportedUrls = 0;

    for await (const ad of provider.syncStandardAdDestinations(
      session,
      googleCustomerId,
    )) {
      for (const source of sourcesFromStandardAd(ad)) {
        itemsSeen += 1;
        const kind = await persistSource(persistContext, source);
        if (kind === "unsupported" || kind === "blocked") unsupportedUrls += 1;
      }
    }
    for await (const group of provider.syncPerformanceMaxDestinations(
      session,
      googleCustomerId,
    )) {
      for (const source of sourcesFromPerformanceMax(group)) {
        itemsSeen += 1;
        const kind = await persistSource(persistContext, source);
        if (kind === "unsupported" || kind === "blocked") unsupportedUrls += 1;
      }
    }
    for await (const page of provider.syncObservedLandingPages(
      session,
      googleCustomerId,
      lookbackRange(config.observedLookbackDays),
    )) {
      itemsSeen += 1;
      const kind = await persistSource(
        persistContext,
        sourceFromObserved(page),
      );
      if (kind === "unsupported" || kind === "blocked") unsupportedUrls += 1;
    }

    await database.googleAdsDestinationReference.updateMany({
      where: {
        googleAdsCustomerId: customer.id,
        lastSyncGeneration: { not: generation },
        sourceActive: true,
      },
      data: { sourceActive: false },
    });
    await recomputeCustomerTargets(customer.id);

    const [
      uniqueDestinations,
      enabledReferences,
      needsApproval,
      matchedWebsites,
    ] = await Promise.all([
      database.googleAdsDestinationTarget.count({
        where: {
          googleAdsCustomerId: customer.id,
          approvalStatus: { in: ["APPROVED", "NEEDS_APPROVAL"] },
        },
      }),
      database.googleAdsDestinationReference.count({
        where: { googleAdsCustomerId: customer.id, sourceActive: true },
      }),
      database.googleAdsDestinationTarget.count({
        where: {
          googleAdsCustomerId: customer.id,
          approvalStatus: "NEEDS_APPROVAL",
        },
      }),
      database.googleAdsDestinationTarget.count({
        where: {
          googleAdsCustomerId: customer.id,
          websiteId: { not: null },
          approvalStatus: "APPROVED",
        },
      }),
    ]);

    await database.googleAdsSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date(),
        itemsSeen,
        destinationsSeen: uniqueDestinations,
        enabledReferences,
        uniqueDestinations,
        matchedWebsites,
        needsApproval,
        unsupportedUrls,
      },
    });
    await database.googleAdsCustomer.update({
      where: { id: customer.id },
      data: { lastSyncedAt: new Date(), status: "ACTIVE" },
    });
    await database.googleAdsConnection.update({
      where: { id: customer.connectionId },
      data: {
        lastSuccessfulSyncAt: new Date(),
        lastSyncErrorCode: null,
        status: "CONNECTED",
      },
    });
    logger.info("google_ads.sync.completed", {
      organizationId: customer.organizationId,
      connectionId: customer.connectionId,
      customerId: customer.id,
      syncRunId: run.id,
      itemsSeen,
    });
    return "completed";
  } catch (error) {
    const mapped = mapProviderFailure(error);
    if (mapped.authFailure) {
      await database.googleAdsConnection.update({
        where: { id: customer.connectionId },
        data: {
          status: "REAUTH_REQUIRED",
          lastSyncErrorCode: mapped.code,
        },
      });
      logger.warn("google_ads.reauth_required", {
        organizationId: customer.organizationId,
        connectionId: customer.connectionId,
        customerId: customer.id,
        providerRequestId: mapped.providerRequestId,
      });
    } else if (mapped.accessLost) {
      await database.googleAdsCustomer.update({
        where: { id: customer.id },
        data: { status: "ACCESS_LOST" },
      });
    } else if (mapped.platformConfig) {
      await database.googleAdsConnection.update({
        where: { id: customer.connectionId },
        data: {
          status: "ERROR",
          lastSyncErrorCode: mapped.code,
        },
      });
    }
    if (syncRunId) {
      await database.googleAdsSyncRun.update({
        where: { id: syncRunId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorCode: mapped.code,
          providerRequestId: mapped.providerRequestId,
        },
      });
    }
    logger.error("google_ads.sync.failed", {
      organizationId: customer.organizationId,
      connectionId: customer.connectionId,
      customerId: customer.id,
      syncRunId,
      errorCode: mapped.code,
      providerRequestId: mapped.providerRequestId,
    });
    if (mapped.retryable && !mapped.authFailure && !mapped.accessLost) {
      throw mapped;
    }
    return "failed";
  } finally {
    try {
      if (locked) await unlockCustomer(client, customer.id);
    } finally {
      client.release();
    }
  }
}

export async function claimDueGoogleAdsCustomers(now = new Date()): Promise<
  Array<{
    connectionId: string;
    googleCustomerId: string;
    organizationId: string;
  }>
> {
  const intervalMs = getGoogleAdsConfig().syncIntervalSeconds * 1000;
  const dueBefore = new Date(now.getTime() - intervalMs);
  return database.googleAdsCustomer.findMany({
    where: {
      selected: true,
      isManager: false,
      status: "ACTIVE",
      connection: {
        status: "CONNECTED",
        encryptedRefreshToken: { not: null },
      },
      organization: {
        billingSubscription: {
          status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] },
        },
      },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: dueBefore } }],
    },
    take: getGoogleAdsConfig().schedulerBatchSize,
    orderBy: { lastSyncedAt: "asc" },
    select: {
      connectionId: true,
      googleCustomerId: true,
      organizationId: true,
    },
  });
}
