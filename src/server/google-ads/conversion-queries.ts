import type { GoogleAdsConversionExportStatus } from "@/generated/prisma/enums";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { AuthorizationError } from "@/server/authorization/errors";
import { database } from "@/server/database";

async function requireRead(userId: string, organizationSlug: string) {
  const access = await loadOrganizationAccess(userId, organizationSlug);
  if (access.status !== "ok") throw new AuthorizationError();
  if (
    !hasOrganizationPermission(
      access.context.membership.role,
      "integrations:read",
    )
  ) {
    throw new AuthorizationError();
  }
  return {
    organization: access.context.organization,
    role: access.context.membership.role,
  };
}

export async function listConversionExports(
  userId: string,
  organizationSlug: string,
  filters: { status?: string; websiteId?: string; from?: string; to?: string },
) {
  const { organization, role } = await requireRead(userId, organizationSlug);
  const status = filters.status as GoogleAdsConversionExportStatus | undefined;
  const from =
    filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)
      ? new Date(`${filters.from}T00:00:00.000Z`)
      : undefined;
  const to =
    filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      ? new Date(`${filters.to}T00:00:00.000Z`)
      : undefined;
  const toEnd = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000) : undefined;
  const rows = await database.googleAdsConversionExport.findMany({
    where: {
      organizationId: organization.id,
      ...(status ? { status } : {}),
      ...(filters.websiteId ? { websiteId: filters.websiteId } : {}),
      ...(from || toEnd
        ? {
            conversionTimestamp: {
              ...(from ? { gte: from } : {}),
              ...(toEnd ? { lt: toEnd } : {}),
            },
          }
        : {}),
    },
    include: {
      lead: { select: { id: true, publicLeadId: true } },
      website: { select: { id: true, name: true, hostname: true } },
      config: { select: { conversionActionNameSnapshot: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return {
    rows,
    canManage: hasOrganizationPermission(role, "integrations:manage"),
  };
}

export async function getLeadConversionExport(
  organizationId: string,
  leadId: string,
) {
  return database.googleAdsConversionExport.findFirst({
    where: { organizationId, leadId },
    include: {
      config: {
        select: { conversionActionNameSnapshot: true, eventSource: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
