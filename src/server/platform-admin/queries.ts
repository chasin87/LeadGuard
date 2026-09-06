import type {
  BillingPlanKey,
  BillingSubscriptionStatus,
  IncidentStatus,
} from "@/generated/prisma/enums";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { DomainError } from "@/server/authorization/errors";
import { loadEntitlements } from "@/server/billing/limits";
import { database } from "@/server/database";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import type { PlatformActor } from "@/server/platform-admin/access";
import {
  accountStatus,
  boundSearch,
  PAGE_SIZE,
} from "@/server/platform-admin/constants";
import { formatMoney } from "@/lib/money";

export type OrganizationListFilters = {
  q?: string;
  plan?: BillingPlanKey | "";
  billingStatus?: BillingSubscriptionStatus | "";
  trial?: boolean;
  suspended?: boolean;
  overLimit?: boolean;
  openIncidents?: boolean;
  googleConnected?: boolean;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
};

function parseDay(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

export async function listPlatformOrganizations(
  actor: PlatformActor,
  filters: OrganizationListFilters,
) {
  const searchLimit = consumeRateLimit(
    `platform-org-search:${actor.userId}`,
    30,
    60_000,
  );
  if (!searchLimit.ok) {
    throw new DomainError("Search is rate limited. Try again shortly.");
  }
  const q = boundSearch(filters.q);
  const createdFrom = parseDay(filters.createdFrom);
  const createdTo = parseDay(filters.createdTo);
  const createdToEnd = createdTo
    ? new Date(createdTo.getTime() + 86_400_000)
    : undefined;

  const where = {
    ...(createdFrom || createdToEnd
      ? {
          createdAt: {
            ...(createdFrom ? { gte: createdFrom } : {}),
            ...(createdToEnd ? { lt: createdToEnd } : {}),
          },
        }
      : {}),
    ...(filters.suspended ? { manualSuspendedAt: { not: null } } : {}),
    ...(filters.plan || filters.billingStatus || filters.trial
      ? {
          billingSubscription: {
            ...(filters.plan ? { planKey: filters.plan } : {}),
            ...(filters.billingStatus ? { status: filters.billingStatus } : {}),
            ...(filters.trial ? { status: "TRIALING" as const } : {}),
          },
        }
      : {}),
    ...(filters.googleConnected
      ? { googleAdsConnection: { status: "CONNECTED" as const } }
      : {}),
    ...(filters.openIncidents
      ? {
          websites: {
            some: {
              monitors: {
                some: { incidents: { some: { status: "OPEN" as const } } },
              },
            },
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { id: q },
            { slug: { equals: q } },
            { name: { startsWith: q, mode: "insensitive" as const } },
            { slug: { startsWith: q, mode: "insensitive" as const } },
            {
              billingCustomer: { providerCustomerId: q },
            },
            {
              members: {
                some: {
                  role: "OWNER" as const,
                  user: { email: { equals: q.toLowerCase() } },
                },
              },
            },
          ],
        }
      : {}),
  };

  const rows = await database.organization.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: {
      members: {
        where: { role: "OWNER" },
        take: 1,
        include: {
          user: {
            select: { id: true, email: true, name: true, lastLoginAt: true },
          },
        },
      },
      billingSubscription: {
        select: {
          planKey: true,
          status: true,
          trialEnd: true,
          currentPeriodEnd: true,
        },
      },
      _count: { select: { members: true, websites: true } },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const ids = page.map((row) => row.id);
  const [monitorCounts, incidentCounts, entitlements] = await Promise.all([
    database.monitor.groupBy({
      by: ["websiteId"],
      where: { deletedAt: null, website: { organizationId: { in: ids } } },
      _count: { _all: true },
    }),
    database.incident.groupBy({
      by: ["monitorId"],
      where: {
        status: "OPEN",
        monitor: { website: { organizationId: { in: ids } } },
      },
      _count: { _all: true },
    }),
    Promise.all(ids.map((id) => loadEntitlements(id))),
  ]);

  const websiteIds = await database.website.findMany({
    where: { organizationId: { in: ids } },
    select: { id: true, organizationId: true },
  });
  const websiteOrg = new Map(
    websiteIds.map((row) => [row.id, row.organizationId]),
  );
  const monitorsByOrg = new Map<string, number>();
  for (const row of monitorCounts) {
    const orgId = websiteOrg.get(row.websiteId);
    if (!orgId) continue;
    monitorsByOrg.set(orgId, (monitorsByOrg.get(orgId) ?? 0) + row._count._all);
  }
  const monitorOrg = await database.monitor.findMany({
    where: {
      id: { in: incidentCounts.map((row) => row.monitorId) },
    },
    select: { id: true, website: { select: { organizationId: true } } },
  });
  const monitorToOrg = new Map(
    monitorOrg.map((row) => [row.id, row.website.organizationId]),
  );
  const incidentsByOrg = new Map<string, number>();
  for (const row of incidentCounts) {
    const orgId = monitorToOrg.get(row.monitorId);
    if (!orgId) continue;
    incidentsByOrg.set(
      orgId,
      (incidentsByOrg.get(orgId) ?? 0) + row._count._all,
    );
  }

  let listed = page.map((row, index) => {
    const entitlement = entitlements[index];
    const owner = row.members[0]?.user;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt,
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.name ?? null,
      plan: row.billingSubscription?.planKey ?? null,
      billingStatus: row.billingSubscription?.status ?? "NONE",
      trialEndsAt: row.billingSubscription?.trialEnd ?? null,
      websites: row._count.websites,
      monitors: monitorsByOrg.get(row.id) ?? 0,
      openIncidents: incidentsByOrg.get(row.id) ?? 0,
      users: row._count.members,
      lastActivity: owner?.lastLoginAt ?? row.updatedAt,
      accountStatus: accountStatus({
        manualSuspendedAt: row.manualSuspendedAt,
        billingEffective: entitlement?.effectiveStatus ?? "NONE",
        overLimit: entitlement?.overLimit ?? false,
      }),
      overLimit: entitlement?.overLimit ?? false,
      manualSuspended: Boolean(row.manualSuspendedAt),
    };
  });
  if (filters.overLimit) {
    listed = listed.filter((row) => row.overLimit);
  }
  return {
    rows: listed,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getPlatformOrganization(organizationId: string) {
  const organization = await database.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              lastLoginAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      billingCustomer: {
        select: { provider: true, providerCustomerId: true },
      },
      billingSubscription: true,
      websites: {
        include: {
          trackingConfig: { select: { status: true } },
          googleAdsAnalyticsConfig: { select: { status: true } },
          _count: { select: { monitors: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      googleAdsConnection: {
        select: {
          status: true,
          dataManagerStatus: true,
          googleAccountEmail: true,
          lastSuccessfulSyncAt: true,
          lastSyncErrorCode: true,
        },
      },
      entitlementOverrides: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!organization) return null;
  const entitlements = await loadEntitlements(organization.id);
  const websiteIds = organization.websites.map((site) => site.id);
  const [openIncidents, monitors] = await Promise.all([
    database.incident.count({
      where: {
        status: "OPEN",
        monitor: { website: { organizationId: organization.id } },
      },
    }),
    database.monitor.findMany({
      where: { websiteId: { in: websiteIds }, deletedAt: null },
      select: {
        id: true,
        type: true,
        name: true,
        url: true,
        status: true,
        lastCheckedAt: true,
        websiteId: true,
        incidents: {
          where: { status: "OPEN" },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    organization,
    entitlements,
    openIncidents,
    monitors,
    accountStatus: accountStatus({
      manualSuspendedAt: organization.manualSuspendedAt,
      billingEffective: entitlements.effectiveStatus,
      overLimit: entitlements.overLimit,
    }),
  };
}

export async function listPlatformUsers(filters: {
  q?: string;
  cursor?: string;
}) {
  const q = boundSearch(filters.q);
  const rows = await database.user.findMany({
    where: q
      ? {
          OR: [
            { id: q },
            { email: { equals: q.toLowerCase() } },
            { email: { startsWith: q.toLowerCase() } },
            { name: { startsWith: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      emailVerified: true,
      platformAccess: { select: { role: true, status: true } },
      memberships: {
        select: {
          role: true,
          createdAt: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    rows: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getPlatformUser(userId: string) {
  return database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      emailVerified: true,
      trialConsumedAt: true,
      platformAccess: {
        select: { role: true, status: true, createdAt: true },
      },
      memberships: {
        select: {
          role: true,
          createdAt: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
}

export async function listPlatformIncidents(filters: {
  status?: IncidentStatus | "";
  organizationId?: string;
  type?: string;
  cursor?: string;
}) {
  const rows = await database.incident.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.organizationId
        ? { monitor: { website: { organizationId: filters.organizationId } } }
        : {}),
      ...(filters.type ? { initialErrorType: filters.type as never } : {}),
    },
    orderBy: { detectedAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: {
      monitor: {
        select: {
          id: true,
          name: true,
          type: true,
          url: true,
          website: {
            select: {
              id: true,
              hostname: true,
              name: true,
              organizationId: true,
              organization: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nowMs = Date.now();
  return {
    rows: page.map((incident) => ({
      ...incident,
      ageHours: Math.max(
        0,
        Math.round((nowMs - incident.detectedAt.getTime()) / 3_600_000),
      ),
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getPlatformIncident(incidentId: string) {
  return database.incident.findUnique({
    where: { id: incidentId },
    include: {
      monitor: {
        include: {
          website: {
            include: {
              organization: { select: { id: true, name: true, slug: true } },
            },
          },
          checks: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              status: true,
              errorType: true,
              httpStatus: true,
              createdAt: true,
              finishedAt: true,
            },
          },
        },
      },
    },
  });
}

export async function listPlatformAudit(filters: {
  organizationId?: string;
  cursor?: string;
}) {
  const rows = await database.platformAuditEvent.findMany({
    where: filters.organizationId
      ? { organizationId: filters.organizationId }
      : {},
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    rows: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getOrganizationIntegrations(organizationId: string) {
  const [connection, conversion, outcomes, unmatched, tracking, receipts] =
    await Promise.all([
      database.googleAdsConnection.findUnique({
        where: { organizationId },
        select: {
          status: true,
          dataManagerStatus: true,
          lastSuccessfulSyncAt: true,
          lastSyncErrorCode: true,
          googleAccountEmail: true,
          _count: { select: { customers: true } },
        },
      }),
      database.googleAdsConversionExport.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      database.externalOutcomeEvent.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      database.externalOutcomeEvent.count({
        where: { organizationId, status: "UNMATCHED" },
      }),
      database.websiteTrackingConfig.count({
        where: { organizationId, status: "ENABLED" },
      }),
      database.leadReceiptVerification.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);
  return {
    googleAds: connection,
    conversion: Object.fromEntries(
      conversion.map((row) => [row.status, row._count._all]),
    ),
    outcomes: Object.fromEntries(
      outcomes.map((row) => [row.status, row._count._all]),
    ),
    unmatched,
    trackingEnabled: tracking,
    receipts: Object.fromEntries(
      receipts.map((row) => [row.status, row._count._all]),
    ),
  };
}

export async function listConversionExportsForOrganization(
  organizationId: string,
  includeExactRevenue: boolean,
) {
  const rows = await database.googleAdsConversionExport.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      conversionTimestamp: true,
      identifierTypes: true,
      currencyCode: true,
      valueAmountMinor: true,
      lastErrorCode: true,
      lead: { select: { publicLeadId: true } },
      config: { select: { conversionActionNameSnapshot: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    publicLeadId: row.lead.publicLeadId,
    status: row.status,
    action: row.config.conversionActionNameSnapshot,
    conversionTimestamp: row.conversionTimestamp,
    identifierTypes: row.identifierTypes,
    currencyCode: row.currencyCode,
    value:
      includeExactRevenue && row.valueAmountMinor != null && row.currencyCode
        ? formatMoney(row.valueAmountMinor, row.currencyCode)
        : row.currencyCode
          ? `hasValue ${row.currencyCode}`
          : null,
  }));
}

export async function getOrganizationRevenueSummary(
  organizationId: string,
  includeExactRevenue: boolean,
) {
  const ads = getGoogleAdsConfig();
  const staleAfterMs = ads.analyticsSpendStaleAfterHours * 60 * 60 * 1000;
  const [leads, won, revenue, analytics, spend] = await Promise.all([
    database.lead.count({ where: { organizationId } }),
    database.leadOutcome.count({ where: { organizationId, status: "WON" } }),
    database.leadOutcome.groupBy({
      by: ["revenueCurrencyCode"],
      where: {
        organizationId,
        status: "WON",
        revenueAmountMinor: { not: null },
        revenueCurrencyCode: { not: null },
      },
      _sum: { revenueAmountMinor: true },
      _count: { _all: true },
    }),
    database.googleAdsAnalyticsConfig.findMany({
      where: { organizationId },
      select: {
        status: true,
        lastSuccessfulSyncAt: true,
        lastErrorCode: true,
        website: { select: { hostname: true } },
      },
    }),
    database.googleAdsPerformanceDaily.groupBy({
      by: ["currencyCode"],
      where: { organizationId },
      _sum: { costMicros: true },
    }),
  ]);
  const now = Date.now();
  return {
    leads,
    won,
    revenue: revenue.map((row) => ({
      currency: row.revenueCurrencyCode,
      count: row._count._all,
      amount: includeExactRevenue ? row._sum.revenueAmountMinor : null,
    })),
    spend: includeExactRevenue
      ? spend.map((row) => ({
          currency: row.currencyCode,
          costMicros: row._sum.costMicros,
        }))
      : spend.map((row) => ({
          currency: row.currencyCode,
          costMicros: null,
        })),
    analytics: analytics.map((row) => ({
      website: row.website.hostname,
      status: row.status,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
      lastErrorCode: row.lastErrorCode,
      health: analyticsHealth(
        row.status,
        row.lastSuccessfulSyncAt,
        now,
        staleAfterMs,
      ),
    })),
  };
}

function analyticsHealth(
  status: string,
  lastSuccessfulSyncAt: Date | null,
  now: number,
  staleAfterMs: number,
) {
  if (status === "NEEDS_REAUTH") return "Reauth required";
  if (status === "ERROR") return "Failed";
  if (!lastSuccessfulSyncAt) return "Delayed";
  const age = now - lastSuccessfulSyncAt.getTime();
  if (age <= staleAfterMs / 4) return "Fresh";
  if (age <= staleAfterMs) return "Delayed";
  return "Stale";
}

export async function listPlatformIntegrations() {
  const [google, unmatched, conversion] = await Promise.all([
    database.googleAdsConnection.findMany({
      select: {
        organizationId: true,
        status: true,
        dataManagerStatus: true,
        organization: { select: { name: true, slug: true } },
      },
      take: 80,
      orderBy: { updatedAt: "desc" },
    }),
    database.externalOutcomeEvent.groupBy({
      by: ["organizationId"],
      where: { status: "UNMATCHED" },
      _count: { _all: true },
    }),
    database.googleAdsConversionExport.groupBy({
      by: ["organizationId", "status"],
      where: {
        status: {
          in: ["RETRYABLE_ERROR", "REJECTED", "NEEDS_REVIEW", "OUT_OF_SYNC"],
        },
      },
      _count: { _all: true },
    }),
  ]);
  return { google, unmatched, conversion };
}

export async function listPlatformAdmins() {
  return database.platformAccess.findMany({
    where: { status: "ACTIVE" },
    include: {
      user: { select: { id: true, email: true, name: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
