import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import {
  getGoogleAdsConfig,
  googleAdsAnalyticsBackfillQueue,
  googleAdsAnalyticsSyncQueue,
} from "@/server/google-ads/config";
import { googleAdsUserErrors } from "@/server/google-ads/errors";
import { capabilitiesFromGrantedScopes } from "@/server/google-ads/scopes";
import {
  enqueueGoogleAdsAnalyticsBackfill,
  enqueueGoogleAdsAnalyticsSync,
  enqueueGoogleAdsClickResolution,
} from "@/jobs/queue";
import { requireFeature } from "@/server/billing/limits";
import { createLogger } from "@/server/logger";
import { addIsoDays, todayInTimeZone } from "@/server/revenue-analytics/dates";

const logger = createLogger("google-ads-analytics");

export const analyticsUserErrors = {
  memberDenied: "You do not have permission to change revenue analytics.",
  noWebsite: "Select a website that belongs to this organization.",
  noCustomer:
    "Select a Google Ads advertiser account that belongs to this connection.",
  customerConflict:
    "This website already maps conversion feedback to a different Google Ads account. Use the same advertiser account for analytics.",
  feedbackConflict:
    "This website already maps revenue analytics to a different Google Ads account. Use the same advertiser account for conversion feedback.",
  notConnected: "Connect Google Ads before enabling revenue analytics.",
} as const;

async function requireManage(userId: string, organizationSlug: string) {
  return requireOrganizationRole(
    userId,
    organizationSlug,
    "integrations:manage",
  );
}

async function requireRead(userId: string, organizationSlug: string) {
  return requireOrganizationRole(userId, organizationSlug, "integrations:read");
}

export async function assertWebsiteCustomerAlignment(input: {
  organizationId: string;
  websiteId: string;
  googleAdsCustomerId: string;
  source: "analytics" | "feedback";
}) {
  if (input.source === "analytics") {
    const feedback =
      await database.googleAdsConversionFeedbackConfig.findUnique({
        where: { websiteId: input.websiteId },
      });
    if (
      feedback &&
      (feedback.status === "ACTIVE" || feedback.status === "READY") &&
      feedback.googleAdsCustomerId !== input.googleAdsCustomerId
    ) {
      throw new DomainError(analyticsUserErrors.customerConflict);
    }
    return;
  }
  const analytics = await database.googleAdsAnalyticsConfig.findUnique({
    where: { websiteId: input.websiteId },
  });
  if (
    analytics &&
    analytics.status === "ACTIVE" &&
    analytics.googleAdsCustomerId !== input.googleAdsCustomerId
  ) {
    throw new DomainError(analyticsUserErrors.feedbackConflict);
  }
}

export async function enableGoogleAdsAnalytics(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  googleAdsCustomerId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const [website, customer, connection] = await Promise.all([
    database.website.findFirst({
      where: { id: input.websiteId, organizationId: organization.id },
    }),
    database.googleAdsCustomer.findFirst({
      where: {
        id: input.googleAdsCustomerId,
        organizationId: organization.id,
        isManager: false,
        selected: true,
      },
    }),
    database.googleAdsConnection.findUnique({
      where: { organizationId: organization.id },
    }),
  ]);
  if (!website) throw new DomainError(analyticsUserErrors.noWebsite);
  if (!customer || !connection || connection.status === "DISCONNECTED") {
    throw new DomainError(analyticsUserErrors.noCustomer);
  }
  await requireFeature(organization.id, "revenueAnalytics");
  await assertWebsiteCustomerAlignment({
    organizationId: organization.id,
    websiteId: website.id,
    googleAdsCustomerId: customer.id,
    source: "analytics",
  });
  const now = new Date();
  const config = await database.googleAdsAnalyticsConfig.upsert({
    where: { websiteId: website.id },
    create: {
      organizationId: organization.id,
      websiteId: website.id,
      googleAdsConnectionId: connection.id,
      googleAdsCustomerId: customer.id,
      status: "ACTIVE",
      enabledAt: now,
      disabledAt: null,
      nextSyncAt: now,
      lastErrorCode: null,
    },
    update: {
      googleAdsConnectionId: connection.id,
      googleAdsCustomerId: customer.id,
      status: "ACTIVE",
      enabledAt: now,
      disabledAt: null,
      nextSyncAt: now,
      lastErrorCode: null,
    },
  });
  logger.info("google_ads.analytics.enabled", {
    organizationId: organization.id,
    websiteId: website.id,
    customerId: customer.id,
  });
  if (process.env.VITEST !== "true") {
    await enqueueGoogleAdsAnalyticsBackfill({
      googleAdsCustomerId: customer.id,
      organizationId: organization.id,
    });
    await enqueuePendingClickResolutionsForCustomer({
      organizationId: organization.id,
      googleAdsCustomerId: customer.id,
      websiteId: website.id,
    });
  }
  return config;
}

export async function disableGoogleAdsAnalytics(input: {
  userId: string;
  organizationSlug: string;
  configId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const config = await database.googleAdsAnalyticsConfig.findFirst({
    where: { id: input.configId, organizationId: organization.id },
  });
  if (!config) throw new DomainError("Revenue analytics is not configured.");
  return database.googleAdsAnalyticsConfig.update({
    where: { id: config.id },
    data: { status: "DISABLED", disabledAt: new Date(), nextSyncAt: null },
  });
}

export async function enqueueManualAnalyticsRefresh(input: {
  userId: string;
  organizationSlug: string;
  googleAdsCustomerId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const ads = getGoogleAdsConfig();
  const config = await database.googleAdsAnalyticsConfig.findFirst({
    where: {
      organizationId: organization.id,
      googleAdsCustomerId: input.googleAdsCustomerId,
      status: { in: ["ACTIVE", "ERROR", "NEEDS_REAUTH"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!config) throw new DomainError("Revenue analytics is not configured.");
  if (
    config.lastManualRefreshAt &&
    Date.now() - config.lastManualRefreshAt.getTime() <
      ads.analyticsManualRefreshCooldownSeconds * 1000
  ) {
    throw new DomainError(googleAdsUserErrors.analyticsCooldown);
  }
  await database.googleAdsAnalyticsConfig.updateMany({
    where: {
      organizationId: organization.id,
      googleAdsCustomerId: input.googleAdsCustomerId,
    },
    data: { lastManualRefreshAt: new Date() },
  });
  if (process.env.VITEST === "true") return { queued: false };
  await enqueueGoogleAdsAnalyticsSync({
    googleAdsCustomerId: input.googleAdsCustomerId,
    organizationId: organization.id,
    kind: "MANUAL",
  });
  return { queued: true };
}

export async function enqueueManualAnalyticsBackfill(input: {
  userId: string;
  organizationSlug: string;
  googleAdsCustomerId: string;
  days?: number;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const ads = getGoogleAdsConfig();
  const config = await database.googleAdsAnalyticsConfig.findFirst({
    where: {
      organizationId: organization.id,
      googleAdsCustomerId: input.googleAdsCustomerId,
      status: { in: ["ACTIVE", "ERROR"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!config) throw new DomainError("Revenue analytics is not configured.");
  if (
    config.lastBackfillAt &&
    Date.now() - config.lastBackfillAt.getTime() <
      ads.analyticsBackfillCooldownSeconds * 1000
  ) {
    throw new DomainError(googleAdsUserErrors.analyticsBackfillCooldown);
  }
  await database.googleAdsAnalyticsConfig.updateMany({
    where: {
      organizationId: organization.id,
      googleAdsCustomerId: input.googleAdsCustomerId,
    },
    data: { lastBackfillAt: new Date() },
  });
  if (process.env.VITEST === "true") {
    return {
      queued: false,
      days: input.days ?? ads.analyticsDefaultBackfillDays,
    };
  }
  await enqueueGoogleAdsAnalyticsBackfill({
    googleAdsCustomerId: input.googleAdsCustomerId,
    organizationId: organization.id,
    days: input.days,
  });
  return { queued: true, days: input.days ?? ads.analyticsDefaultBackfillDays };
}

export async function claimDueAnalyticsCustomers(
  now = new Date(),
): Promise<Array<{ googleAdsCustomerId: string; organizationId: string }>> {
  const ads = getGoogleAdsConfig();
  const due = await database.googleAdsAnalyticsConfig.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
    },
    distinct: ["googleAdsCustomerId"],
    select: {
      googleAdsCustomerId: true,
      organizationId: true,
    },
    take: ads.schedulerBatchSize,
  });
  if (due.length === 0) return [];
  const next = new Date(
    now.getTime() + ads.analyticsSyncIntervalSeconds * 1000,
  );
  await database.googleAdsAnalyticsConfig.updateMany({
    where: {
      googleAdsCustomerId: { in: due.map((row) => row.googleAdsCustomerId) },
      status: "ACTIVE",
    },
    data: { nextSyncAt: next },
  });
  return due;
}

export async function enqueuePendingClickResolutionsForCustomer(input: {
  organizationId: string;
  googleAdsCustomerId: string;
  websiteId?: string;
}) {
  const ads = getGoogleAdsConfig();
  const customer = await database.googleAdsCustomer.findFirst({
    where: {
      id: input.googleAdsCustomerId,
      organizationId: input.organizationId,
    },
  });
  if (!customer) return 0;
  const timeZone = customer.timeZone || "UTC";
  const today = todayInTimeZone(new Date(), timeZone);
  const lookbackFrom = addIsoDays(today, -(ads.clickViewLookbackDays - 1));
  const leads = await database.lead.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.websiteId ? { websiteId: input.websiteId } : {}),
      website: {
        googleAdsAnalyticsConfig: {
          status: "ACTIVE",
          googleAdsCustomerId: customer.id,
        },
      },
      attribution: {
        attributionStatus: "ATTRIBUTED",
        primaryTouch: {
          capturedAt: { gte: new Date(`${lookbackFrom}T00:00:00.000Z`) },
          OR: [{ hasGclid: true }, { hasGbraid: true }, { hasWbraid: true }],
        },
      },
      googleAdsLeadAttributionResolution: null,
    },
    select: {
      id: true,
      organizationId: true,
    },
    take: 500,
  });
  for (const lead of leads) {
    await enqueueGoogleAdsClickResolution({
      leadId: lead.id,
      organizationId: lead.organizationId,
      googleAdsCustomerId: customer.id,
    });
  }
  return leads.length;
}

export async function getAnalyticsSetupOverview(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireRead(userId, organizationSlug);
  const [connection, configs, websites, customers, feedback] =
    await Promise.all([
      database.googleAdsConnection.findUnique({
        where: { organizationId: organization.id },
      }),
      database.googleAdsAnalyticsConfig.findMany({
        where: { organizationId: organization.id },
        include: {
          website: { select: { id: true, name: true, hostname: true } },
          customer: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      database.website.findMany({
        where: { organizationId: organization.id, status: "ACTIVE" },
        select: { id: true, name: true, hostname: true },
        orderBy: { name: "asc" },
      }),
      database.googleAdsCustomer.findMany({
        where: {
          organizationId: organization.id,
          selected: true,
          isManager: false,
        },
        orderBy: { descriptiveName: "asc" },
      }),
      database.googleAdsConversionFeedbackConfig.findMany({
        where: {
          organizationId: organization.id,
          status: { in: ["ACTIVE", "READY"] },
        },
        select: { websiteId: true, googleAdsCustomerId: true },
      }),
    ]);
  const suggestedCustomerByWebsite = Object.fromEntries(
    feedback.map((row) => [row.websiteId, row.googleAdsCustomerId]),
  );
  return {
    connection,
    configs,
    websites,
    customers,
    suggestedCustomerByWebsite,
    capabilities: capabilitiesFromGrantedScopes(
      connection?.grantedScopes,
      connection?.status ?? "DISCONNECTED",
    ),
  };
}

export { googleAdsAnalyticsSyncQueue, googleAdsAnalyticsBackfillQueue };
