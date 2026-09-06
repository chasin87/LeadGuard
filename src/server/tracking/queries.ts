import type { LeadOutcomeStatus } from "@/generated/prisma/enums";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { AuthorizationError } from "@/server/authorization/errors";
import { WebsiteNotFoundError } from "@/server/security/errors";
import { database } from "@/server/database";
import { LEAD_OUTCOME_STATUSES } from "@/server/leads/outcome";

async function requireRead(userId: string, organizationSlug: string) {
  const access = await loadOrganizationAccess(userId, organizationSlug);
  if (access.status !== "ok") throw new AuthorizationError();
  if (
    !hasOrganizationPermission(access.context.membership.role, "leads:read")
  ) {
    throw new AuthorizationError();
  }
  return {
    organization: access.context.organization,
    role: access.context.membership.role,
  };
}

export async function getWebsiteTrackingView(
  userId: string,
  organizationSlug: string,
  websiteId: string,
) {
  const access = await loadOrganizationAccess(userId, organizationSlug);
  if (access.status !== "ok") throw new AuthorizationError();
  if (
    !hasOrganizationPermission(access.context.membership.role, "websites:read")
  ) {
    throw new AuthorizationError();
  }
  const website = await database.website.findFirst({
    where: { id: websiteId, organizationId: access.context.organization.id },
    include: { trackingConfig: true },
  });
  if (!website) throw new WebsiteNotFoundError();
  return website;
}

export type LeadListFilters = {
  status?: string;
  websiteId?: string;
  from?: string;
  to?: string;
  q?: string;
};

function parseStatus(value: string | undefined): LeadOutcomeStatus | undefined {
  if (!value) return undefined;
  return LEAD_OUTCOME_STATUSES.find((status) => status === value);
}

function parseDayStart(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDayEnd(value: string | undefined): Date | undefined {
  const start = parseDayStart(value);
  if (!start) return undefined;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export async function listOrganizationLeads(
  userId: string,
  organizationSlug: string,
  filters: LeadListFilters = {},
) {
  const { organization, role } = await requireRead(userId, organizationSlug);
  const status = parseStatus(filters.status);
  const from = parseDayStart(filters.from);
  const to = parseDayEnd(filters.to);
  const query = filters.q?.trim().slice(0, 80);
  const websiteId = filters.websiteId?.trim() || undefined;

  const where = {
    organizationId: organization.id,
    ...(websiteId ? { websiteId } : {}),
    ...(from || to
      ? {
          occurredAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lt: to } : {}),
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { publicLeadId: { equals: query } },
            { externalLeadId: { equals: query } },
          ],
        }
      : {}),
    ...(status ? { outcome: { status } } : {}),
  };

  const [
    leads,
    attributionTotals,
    outcomeTotals,
    wonRevenue,
    trackingConfigs,
    websites,
  ] = await Promise.all([
    database.lead.findMany({
      where,
      include: {
        website: { select: { id: true, name: true } },
        outcome: true,
        attribution: {
          include: {
            primaryTouch: {
              select: {
                hasGclid: true,
                hasGbraid: true,
                hasWbraid: true,
                landingPath: true,
                channel: true,
                capturedAt: true,
              },
            },
            firstTouch: {
              select: {
                hasGclid: true,
                hasGbraid: true,
                hasWbraid: true,
                capturedAt: true,
              },
            },
          },
        },
      },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }),
    database.leadAttribution.groupBy({
      by: ["attributionStatus"],
      where: { organizationId: organization.id },
      _count: { _all: true },
    }),
    database.leadOutcome.groupBy({
      by: ["status"],
      where: { organizationId: organization.id },
      _count: { _all: true },
    }),
    database.leadOutcome.groupBy({
      by: ["revenueCurrencyCode"],
      where: {
        organizationId: organization.id,
        status: "WON",
        revenueAmountMinor: { not: null },
        revenueCurrencyCode: { not: null },
      },
      _sum: { revenueAmountMinor: true },
    }),
    database.websiteTrackingConfig.findMany({
      where: { organizationId: organization.id },
      select: { status: true, lastEventReceivedAt: true },
    }),
    database.website.findMany({
      where: { organizationId: organization.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    leads,
    totals: attributionTotals,
    outcomeTotals,
    wonRevenue,
    trackingConfigs,
    websites,
    organization,
    canManage: hasOrganizationPermission(role, "leads:manage"),
  };
}

export async function getLeadDetail(
  userId: string,
  organizationSlug: string,
  leadId: string,
) {
  const { organization, role } = await requireRead(userId, organizationSlug);
  const lead = await database.lead.findFirst({
    where: { organizationId: organization.id, id: leadId },
    include: {
      website: { select: { id: true, name: true, hostname: true } },
      outcome: {
        include: {
          events: {
            orderBy: { createdAt: "asc" },
            include: {
              actor: { select: { id: true, name: true } },
            },
          },
        },
      },
      attribution: {
        include: {
          primaryTouch: {
            select: {
              hasGclid: true,
              hasGbraid: true,
              hasWbraid: true,
              landingPath: true,
              landingOrigin: true,
              channel: true,
              capturedAt: true,
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
            },
          },
          firstTouch: {
            select: {
              hasGclid: true,
              hasGbraid: true,
              hasWbraid: true,
              capturedAt: true,
              channel: true,
            },
          },
        },
      },
    },
  });
  if (!lead) return null;
  return {
    lead,
    organization,
    canManage: hasOrganizationPermission(role, "leads:manage"),
  };
}
