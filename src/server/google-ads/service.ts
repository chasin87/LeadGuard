import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { PlanLimitError, requireFeature } from "@/server/billing/limits";
import { suggestedWebsiteName } from "@/lib/urls/normalize-url";
import { createWebsite } from "@/server/websites/service";
import { enqueueGoogleAdsImpact, enqueueGoogleAdsSync } from "@/jobs/queue";
import {
  getGoogleAdsAuthClient,
  getGoogleAdsReadProvider,
  mapProviderFailure,
} from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { decryptSecret } from "@/server/google-ads/encryption";
import { googleAdsUserErrors } from "@/server/google-ads/errors";
import {
  isGoogleCustomerId,
  normalizeGoogleCustomerId,
} from "@/server/google-ads/ids";
import {
  ensurePendingImpact,
  executeGoogleAdsImpactJob,
} from "@/server/google-ads/impact/refresh";
import {
  executeGoogleAdsSyncJob,
  reconcileDestinationMonitor,
} from "@/server/google-ads/sync";
import type { DnsResolver } from "@/server/security/ssrf";
import { createLogger } from "@/server/logger";

const logger = createLogger("google-ads");

async function requireIntegrationRead(
  userId: string,
  organizationSlug: string,
) {
  return requireOrganizationRole(userId, organizationSlug, "integrations:read");
}

async function requireIntegrationManage(
  userId: string,
  organizationSlug: string,
) {
  return requireOrganizationRole(
    userId,
    organizationSlug,
    "integrations:manage",
  );
}

async function loadConnectionForOrg(organizationId: string) {
  return database.googleAdsConnection.findUnique({
    where: { organizationId },
  });
}

async function readSessionForConnection(connection: {
  encryptedRefreshToken: string | null;
}) {
  const config = getGoogleAdsConfig();
  if (!connection.encryptedRefreshToken) {
    throw new DomainError(googleAdsUserErrors.reauthRequired);
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
    loginCustomerId: null as string | null,
  };
}

export async function getGoogleAdsOverview(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireIntegrationRead(
    userId,
    organizationSlug,
  );
  const connection = await loadConnectionForOrg(organization.id);
  if (!connection) {
    return {
      connection: null,
      customers: [],
      destinations: [],
      latestSync: null,
    };
  }
  const [customers, destinations, latestSync, failing] = await Promise.all([
    database.googleAdsCustomer.findMany({
      where: { organizationId: organization.id },
      orderBy: { descriptiveName: "asc" },
    }),
    database.googleAdsDestinationTarget.findMany({
      where: { organizationId: organization.id },
      include: {
        references: {
          select: {
            id: true,
            sourceActive: true,
            campaignId: true,
            campaignName: true,
            sourceType: true,
          },
        },
        website: { select: { id: true, name: true, status: true } },
        monitor: {
          select: {
            id: true,
            status: true,
            lastCheckedAt: true,
            websiteId: true,
            incidents: {
              where: { status: "OPEN" },
              select: { id: true },
              take: 1,
            },
            checks: {
              orderBy: { finishedAt: "desc" },
              take: 1,
              select: { status: true, finishedAt: true, errorType: true },
            },
          },
        },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
    }),
    database.googleAdsSyncRun.findFirst({
      where: { organizationId: organization.id },
      orderBy: { startedAt: "desc" },
    }),
    database.googleAdsDestinationTarget.count({
      where: {
        organizationId: organization.id,
        monitor: { incidents: { some: { status: "OPEN" } } },
      },
    }),
  ]);
  return {
    connection,
    customers,
    destinations,
    latestSync,
    failingCount: failing,
  };
}

export async function discoverGoogleAdsAccounts(input: {
  userId: string;
  organizationSlug: string;
}) {
  const { organization } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const connection = await loadConnectionForOrg(organization.id);
  if (!connection || connection.status === "DISCONNECTED") {
    throw new DomainError(googleAdsUserErrors.notConnected);
  }
  if (connection.status === "REAUTH_REQUIRED") {
    throw new DomainError(googleAdsUserErrors.reauthRequired);
  }
  try {
    const session = await readSessionForConnection(connection);
    const provider = getGoogleAdsReadProvider();
    const accessible = await provider.listAccessibleCustomers(session);
    const discovered = new Map<
      string,
      {
        googleCustomerId: string;
        descriptiveName: string;
        currencyCode: string | null;
        timeZone: string | null;
        isManager: boolean;
        status: string;
        loginCustomerId: string | null;
      }
    >();

    for (const customerId of accessible) {
      const account = await provider.getCustomer(
        { ...session, loginCustomerId: null },
        customerId,
      );
      discovered.set(account.googleCustomerId, {
        ...account,
        loginCustomerId: null,
      });
      if (account.isManager) {
        const children = await provider.getCustomerHierarchy(
          { ...session, loginCustomerId: account.googleCustomerId },
          account.googleCustomerId,
        );
        for (const child of children) {
          if (!discovered.has(child.googleCustomerId)) {
            discovered.set(child.googleCustomerId, child);
          }
        }
      }
    }

    for (const account of discovered.values()) {
      await database.googleAdsCustomer.upsert({
        where: {
          connectionId_googleCustomerId: {
            connectionId: connection.id,
            googleCustomerId: account.googleCustomerId,
          },
        },
        update: {
          descriptiveName: account.descriptiveName,
          currencyCode: account.currencyCode,
          timeZone: account.timeZone,
          isManager: account.isManager,
          loginCustomerId: account.loginCustomerId,
          status:
            account.status === "CANCELED" || account.status === "CANCELLED"
              ? "DISABLED"
              : "ACTIVE",
        },
        create: {
          organizationId: organization.id,
          connectionId: connection.id,
          googleCustomerId: account.googleCustomerId,
          loginCustomerId: account.loginCustomerId,
          descriptiveName: account.descriptiveName,
          currencyCode: account.currencyCode,
          timeZone: account.timeZone,
          isManager: account.isManager,
        },
      });
    }
    return database.googleAdsCustomer.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ isManager: "desc" }, { descriptiveName: "asc" }],
    });
  } catch (error) {
    const mapped = mapProviderFailure(error);
    if (mapped.authFailure) {
      await database.googleAdsConnection.update({
        where: { id: connection.id },
        data: { status: "REAUTH_REQUIRED", lastSyncErrorCode: mapped.code },
      });
      throw new DomainError(googleAdsUserErrors.reauthRequired);
    }
    throw new DomainError(
      googleAdsUserErrors.platformConfig === mapped.message
        ? googleAdsUserErrors.platformConfig
        : "Google Ads could not list accounts. Try again later.",
    );
  }
}

export async function selectGoogleAdsCustomers(input: {
  userId: string;
  organizationSlug: string;
  googleCustomerIds: string[];
}) {
  const { organization } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const connection = await loadConnectionForOrg(organization.id);
  if (!connection) throw new DomainError(googleAdsUserErrors.notConnected);

  const requested = [
    ...new Set(input.googleCustomerIds.map(normalizeGoogleCustomerId)),
  ];
  for (const id of requested) {
    if (!isGoogleCustomerId(id)) {
      throw new DomainError(googleAdsUserErrors.accountNotAccessible);
    }
  }

  const accessible = await database.googleAdsCustomer.findMany({
    where: {
      organizationId: organization.id,
      connectionId: connection.id,
      googleCustomerId: { in: requested },
    },
  });
  if (accessible.length !== requested.length) {
    throw new DomainError(googleAdsUserErrors.accountNotAccessible);
  }
  if (accessible.some((item) => item.isManager)) {
    throw new DomainError(googleAdsUserErrors.managerNotSelectable);
  }
  const entitlements = await requireFeature(
    organization.id,
    "googleAdsDestinationMonitoring",
  );
  if (requested.length > entitlements.limits.maxGoogleAdsCustomers) {
    throw new PlanLimitError(
      "googleAdsCustomers",
      requested.length,
      entitlements.limits.maxGoogleAdsCustomers,
    );
  }

  await database.$transaction([
    database.googleAdsCustomer.updateMany({
      where: { organizationId: organization.id, connectionId: connection.id },
      data: { selected: false },
    }),
    database.googleAdsCustomer.updateMany({
      where: {
        organizationId: organization.id,
        connectionId: connection.id,
        googleCustomerId: { in: requested },
        isManager: false,
      },
      data: { selected: true, status: "ACTIVE" },
    }),
  ]);

  for (const customer of accessible) {
    try {
      await enqueueGoogleAdsSync({
        connectionId: connection.id,
        googleAdsCustomerId: customer.googleCustomerId,
        organizationId: organization.id,
      });
    } catch {
      // Queue is optional in tests; fake provider still syncs in-process.
    }
    if (getGoogleAdsConfig().provider === "fake") {
      await executeGoogleAdsSyncJob({
        connectionId: connection.id,
        googleAdsCustomerId: customer.googleCustomerId,
      });
    }
  }
}

export async function enqueueManualGoogleAdsSync(input: {
  userId: string;
  organizationSlug: string;
  googleCustomerId: string;
}) {
  const { organization } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const customer = await database.googleAdsCustomer.findFirst({
    where: {
      organizationId: organization.id,
      googleCustomerId: normalizeGoogleCustomerId(input.googleCustomerId),
      selected: true,
      isManager: false,
    },
  });
  if (!customer) {
    throw new DomainError(googleAdsUserErrors.accountNotAccessible);
  }
  const cooldown = getGoogleAdsConfig().manualSyncCooldownSeconds * 1000;
  const limit = consumeRateLimit(`google-ads-sync:${customer.id}`, 1, cooldown);
  if (!limit.ok) {
    throw new DomainError(googleAdsUserErrors.syncCooldown);
  }
  try {
    await enqueueGoogleAdsSync({
      connectionId: customer.connectionId,
      googleAdsCustomerId: customer.googleCustomerId,
      organizationId: organization.id,
    });
  } catch {
    if (getGoogleAdsConfig().provider !== "fake") {
      throw new DomainError(googleAdsUserErrors.syncInProgress);
    }
  }
  if (getGoogleAdsConfig().provider === "fake") {
    await executeGoogleAdsSyncJob({
      connectionId: customer.connectionId,
      googleAdsCustomerId: customer.googleCustomerId,
    });
  }
}

export async function approveGoogleAdsDestinationDomain(input: {
  userId: string;
  organizationSlug: string;
  targetId: string;
  resolver?: DnsResolver;
}) {
  const { organization, user } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const target = await database.googleAdsDestinationTarget.findFirst({
    where: { id: input.targetId, organizationId: organization.id },
  });
  if (!target || !target.monitoringUrl) {
    throw new DomainError("This destination cannot be approved.");
  }
  const origin = new URL(target.monitoringUrl).origin;
  let website = await database.website.findFirst({
    where: { organizationId: organization.id, normalizedUrl: origin },
  });
  if (!website) {
    website = await createWebsite(
      {
        userId: user.id,
        organizationSlug: input.organizationSlug,
        name: suggestedWebsiteName(new URL(origin).hostname),
        url: origin,
      },
      { resolver: input.resolver },
    );
  }
  const matching = await database.googleAdsDestinationTarget.findMany({
    where: {
      organizationId: organization.id,
      monitoringUrl: { startsWith: `${origin}/` },
      approvalStatus: { in: ["NEEDS_APPROVAL", "APPROVED"] },
    },
    select: { id: true, monitoringUrl: true },
  });
  const alsoExact = await database.googleAdsDestinationTarget.findMany({
    where: {
      organizationId: organization.id,
      monitoringUrl: origin,
      approvalStatus: { in: ["NEEDS_APPROVAL", "APPROVED"] },
    },
    select: { id: true },
  });
  const ids = new Set([
    ...matching.map((item) => item.id),
    ...alsoExact.map((item) => item.id),
    target.id,
  ]);
  await database.googleAdsDestinationTarget.updateMany({
    where: { id: { in: [...ids] }, organizationId: organization.id },
    data: { websiteId: website.id, approvalStatus: "APPROVED" },
  });
  for (const id of ids) {
    await reconcileDestinationMonitor(id);
  }
  logger.info("google_ads.destination.approved", {
    organizationId: organization.id,
    targetId: target.id,
    websiteId: website.id,
  });
}

export async function ignoreGoogleAdsDestinationDomain(input: {
  userId: string;
  organizationSlug: string;
  targetId: string;
}) {
  const { organization } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const target = await database.googleAdsDestinationTarget.findFirst({
    where: { id: input.targetId, organizationId: organization.id },
  });
  if (!target) throw new DomainError("Destination not found.");
  await database.googleAdsDestinationTarget.updateMany({
    where: { id: target.id, organizationId: organization.id },
    data: { approvalStatus: "IGNORED" },
  });
}

export async function getGoogleAdsDestination(
  userId: string,
  organizationSlug: string,
  targetId: string,
) {
  const { organization } = await requireIntegrationRead(
    userId,
    organizationSlug,
  );
  const target = await database.googleAdsDestinationTarget.findFirst({
    where: { id: targetId, organizationId: organization.id },
    include: {
      customer: true,
      website: true,
      monitor: {
        include: {
          incidents: { where: { status: "OPEN" }, take: 1 },
          checks: { orderBy: { finishedAt: "desc" }, take: 1 },
        },
      },
      references: {
        orderBy: [{ sourceActive: "desc" }, { campaignName: "asc" }],
      },
    },
  });
  if (!target) throw new DomainError("Destination not found.");
  return target;
}

export async function disconnectGoogleAds(input: {
  userId: string;
  organizationSlug: string;
}) {
  const { organization } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const connection = await loadConnectionForOrg(organization.id);
  if (!connection) return;
  let refreshToken: string | null = null;
  if (connection.encryptedRefreshToken) {
    try {
      refreshToken = decryptSecret(connection.encryptedRefreshToken);
    } catch {
      refreshToken = null;
    }
  }
  await database.$transaction([
    database.googleAdsConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        encryptedRefreshToken: null,
        lastSyncErrorCode: null,
      },
    }),
    database.googleAdsDestinationReference.updateMany({
      where: { customer: { connectionId: connection.id } },
      data: { sourceActive: false },
    }),
    database.googleAdsDestinationTarget.updateMany({
      where: { organizationId: organization.id },
      data: { hasActiveSource: false },
    }),
    database.googleAdsIncidentImpact.updateMany({
      where: { organizationId: organization.id, finalizedAt: null },
      data: {
        dataIncomplete: true,
        diagnosticCode: "DISCONNECTED",
        nextRefreshAt: null,
      },
    }),
    database.googleAdsCustomer.updateMany({
      where: { connectionId: connection.id },
      data: { selected: false },
    }),
  ]);
  const monitors = await database.monitor.findMany({
    where: {
      type: "AD_DESTINATION",
      deletedAt: null,
      adDestinationConfig: { userPaused: false },
      website: { organizationId: organization.id },
    },
    select: { id: true },
  });
  if (monitors.length) {
    await database.monitor.updateMany({
      where: { id: { in: monitors.map((item) => item.id) } },
      data: { status: "PAUSED" },
    });
  }
  if (refreshToken) {
    await getGoogleAdsAuthClient()
      .revokeToken(refreshToken)
      .catch(() => undefined);
  }
  logger.info("google_ads.disconnected", {
    organizationId: organization.id,
    connectionId: connection.id,
    userId: input.userId,
  });
}

export async function enqueueManualGoogleAdsImpact(input: {
  userId: string;
  organizationSlug: string;
  incidentId: string;
}) {
  const { organization } = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const incident = await database.incident.findFirst({
    where: {
      id: input.incidentId,
      monitor: {
        type: "AD_DESTINATION",
        website: { organizationId: organization.id },
      },
    },
    select: { id: true },
  });
  if (!incident) {
    throw new DomainError(googleAdsUserErrors.impactNotFound);
  }
  await ensurePendingImpact(incident.id);
  const impact = await database.googleAdsIncidentImpact.findUnique({
    where: { incidentId: incident.id },
    select: { lastManualRefreshAt: true },
  });
  const cooldown =
    getGoogleAdsConfig().impactManualRefreshCooldownSeconds * 1000;
  if (
    impact?.lastManualRefreshAt &&
    Date.now() - impact.lastManualRefreshAt.getTime() < cooldown
  ) {
    throw new DomainError(googleAdsUserErrors.impactCooldown);
  }
  await enqueueGoogleAdsImpact({
    incidentId: incident.id,
    organizationId: organization.id,
    reason: "manual",
  });
  if (getGoogleAdsConfig().provider === "fake") {
    await executeGoogleAdsImpactJob({
      incidentId: incident.id,
      reason: "manual",
    });
  }
}
