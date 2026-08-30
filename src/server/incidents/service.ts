import "server-only";

import type { IncidentStatus } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { IncidentNotFoundError } from "@/server/security/errors";

const openIncidentSelect = {
  id: true,
  status: true,
  startedAt: true,
  detectedAt: true,
  resolvedAt: true,
  initialErrorType: true,
  latestErrorType: true,
  initialHttpStatus: true,
  latestHttpStatus: true,
  failureCount: true,
  firstFailedCheckId: true,
  lastFailedCheckId: true,
  recoveryCheckId: true,
} as const;

const incidentListSelect = {
  id: true,
  status: true,
  startedAt: true,
  detectedAt: true,
  resolvedAt: true,
  latestErrorType: true,
  latestHttpStatus: true,
  failureCount: true,
  monitor: {
    select: {
      id: true,
      name: true,
      normalizedUrl: true,
      deletedAt: true,
      website: {
        select: {
          id: true,
          name: true,
          hostname: true,
        },
      },
    },
  },
  googleAdsIncidentImpact: {
    select: {
      status: true,
      windowCostMicros: true,
      currencyCode: true,
      windowClicksEstimated: true,
      attributionMethod: true,
    },
  },
} as const;

export type IncidentListFilter = "open" | "resolved" | "all";

const listPageSize = 50;

async function requireIncidentRead(userId: string, organizationSlug: string) {
  return requireOrganizationRole(userId, organizationSlug, "incidents:read");
}

export async function countOpenIncidents(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireIncidentRead(userId, organizationSlug);
  return database.incident.count({
    where: {
      status: "OPEN",
      monitor: { website: { organizationId: organization.id } },
    },
  });
}

export async function getOrganizationDashboardStats(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireIncidentRead(userId, organizationSlug);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tenant = { website: { organizationId: organization.id } };

  const [websiteCount, openIncidentCount, failingMonitorCount, checksLast24h] =
    await Promise.all([
      database.website.count({ where: { organizationId: organization.id } }),
      database.incident.count({
        where: { status: "OPEN", monitor: tenant },
      }),
      database.monitor.count({
        where: {
          deletedAt: null,
          consecutiveFailures: { gt: 0 },
          website: { organizationId: organization.id },
          incidents: { none: { status: "OPEN" } },
        },
      }),
      database.monitorCheck.count({
        where: {
          createdAt: { gte: since },
          monitor: tenant,
        },
      }),
    ]);

  const openImpacts = await database.googleAdsIncidentImpact.findMany({
    where: {
      organizationId: organization.id,
      incident: { status: "OPEN" },
      status: { in: ["AVAILABLE", "PARTIAL"] },
      windowCostMicros: { not: null },
    },
    select: { currencyCode: true, windowCostMicros: true },
  });
  const spendByCurrency = new Map<string, bigint>();
  for (const row of openImpacts) {
    if (row.windowCostMicros == null) continue;
    spendByCurrency.set(
      row.currencyCode,
      (spendByCurrency.get(row.currencyCode) ?? 0n) + row.windowCostMicros,
    );
  }

  const openIncidents = await database.incident.findMany({
    where: { status: "OPEN", monitor: tenant },
    orderBy: { detectedAt: "desc" },
    take: 8,
    select: incidentListSelect,
  });

  return {
    websiteCount,
    openIncidentCount,
    failingMonitorCount,
    checksLast24h,
    openIncidents,
    adsSpendAtRisk: [...spendByCurrency.entries()].map(
      ([currencyCode, costMicros]) => ({ currencyCode, costMicros }),
    ),
  };
}

export async function listOrganizationIncidents(
  userId: string,
  organizationSlug: string,
  filter: IncidentListFilter = "open",
) {
  const { organization } = await requireIncidentRead(userId, organizationSlug);
  const status: IncidentStatus | undefined =
    filter === "all" ? undefined : filter === "resolved" ? "RESOLVED" : "OPEN";

  const tenant = { website: { organizationId: organization.id } };
  if (filter === "all") {
    const [open, resolved] = await Promise.all([
      database.incident.findMany({
        where: { status: "OPEN", monitor: tenant },
        orderBy: { detectedAt: "desc" },
        take: listPageSize,
        select: incidentListSelect,
      }),
      database.incident.findMany({
        where: { status: "RESOLVED", monitor: tenant },
        orderBy: { resolvedAt: "desc" },
        take: listPageSize,
        select: incidentListSelect,
      }),
    ]);
    return [...open, ...resolved];
  }

  return database.incident.findMany({
    where: {
      monitor: { website: { organizationId: organization.id } },
      ...(status ? { status } : {}),
    },
    orderBy:
      filter === "resolved" ? { resolvedAt: "desc" } : { detectedAt: "desc" },
    take: listPageSize,
    select: incidentListSelect,
  });
}

export async function getOrganizationIncident(
  userId: string,
  organizationSlug: string,
  incidentId: string,
) {
  const { organization } = await requireIncidentRead(userId, organizationSlug);
  const incident = await database.incident.findFirst({
    where: {
      id: incidentId,
      monitor: { website: { organizationId: organization.id } },
    },
    select: {
      ...openIncidentSelect,
      monitor: {
        select: {
          id: true,
          name: true,
          type: true,
          normalizedUrl: true,
          status: true,
          deletedAt: true,
          website: {
            select: {
              id: true,
              name: true,
              hostname: true,
              status: true,
            },
          },
        },
      },
      lastFailedCheck: {
        select: {
          id: true,
          browserDetail: {
            select: { screenshotKey: true },
          },
        },
      },
      googleAdsIncidentImpact: true,
    },
  });
  if (!incident) {
    throw new IncidentNotFoundError();
  }
  return incident;
}

export async function listIncidentTimelineChecks(
  userId: string,
  organizationSlug: string,
  incidentId: string,
) {
  const incident = await getOrganizationIncident(
    userId,
    organizationSlug,
    incidentId,
  );
  const until = incident.resolvedAt ?? new Date();
  return database.monitorCheck.findMany({
    where: {
      monitorId: incident.monitor.id,
      finishedAt: {
        gte: incident.startedAt,
        lte: until,
      },
    },
    orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      httpStatus: true,
      errorType: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  });
}

export async function getOpenIncidentForMonitor(monitorId: string) {
  return database.incident.findFirst({
    where: { monitorId, status: "OPEN" },
    select: openIncidentSelect,
  });
}
