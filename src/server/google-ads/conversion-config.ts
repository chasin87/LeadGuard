import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { requireFeature } from "@/server/billing/limits";
import { getGoogleAdsReadProvider } from "@/server/google-ads/clients";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import { conversionEligibilityPolicy } from "@/server/google-data-manager/config";
import {
  isSuitableOfflineConversionAction,
  type GoogleAdsConversionAction,
} from "@/server/google-ads/conversion-actions";
import { capabilitiesFromGrantedScopes } from "@/server/google-ads/scopes";
import { refreshGoogleConnectionAccessToken } from "@/server/google-ads/tokens";
import { getGoogleConversionFeedbackProvider } from "@/server/google-data-manager/clients";
import { decryptClickId } from "@/server/tracking/click-crypto";
import { assertWebsiteCustomerAlignment } from "@/server/google-ads/analytics-config";
import type {
  GoogleAdsConversionEventSource,
  GoogleAdsConversionValuePolicy,
} from "@/generated/prisma/enums";

export const conversionFeedbackUserErrors = {
  reauthRequired:
    "Additional Google permission required for conversion feedback.",
  noActions:
    "No suitable conversion action found. Create/import the appropriate offline conversion action in Google Ads first, then refresh this list.",
  noCustomer:
    "Select a Google Ads advertiser account that belongs to this connection.",
  noWebsite: "Select a website that belongs to this organization.",
  confirmEnable:
    "LeadGuard will send future won leads and their configured conversion value to this Google Ads conversion action.",
  memberDenied: "You do not have permission to change conversion feedback.",
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

export async function listConversionActionsForCustomer(input: {
  userId: string;
  organizationSlug: string;
  googleAdsCustomerId: string;
}): Promise<GoogleAdsConversionAction[]> {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const customer = await database.googleAdsCustomer.findFirst({
    where: {
      id: input.googleAdsCustomerId,
      organizationId: organization.id,
      isManager: false,
    },
    include: { connection: true },
  });
  if (!customer) {
    throw new DomainError(conversionFeedbackUserErrors.noCustomer);
  }
  const accessToken = await refreshGoogleConnectionAccessToken(
    customer.connection,
  );
  const adsConfig = getGoogleAdsConfig();
  const actions = await getGoogleAdsReadProvider().listConversionActions(
    {
      accessToken,
      developerToken: adsConfig.developerToken || "fake-developer-token",
      loginCustomerId: customer.loginCustomerId,
    },
    customer.googleCustomerId,
  );
  const now = new Date();
  for (const action of actions) {
    await database.googleAdsConversionActionCache.upsert({
      where: {
        googleAdsCustomerId_conversionActionId: {
          googleAdsCustomerId: customer.id,
          conversionActionId: action.conversionActionId,
        },
      },
      create: {
        organizationId: organization.id,
        googleAdsCustomerId: customer.id,
        conversionActionId: action.conversionActionId,
        name: action.name,
        status: action.status,
        type: action.type,
        category: action.category,
        countingType: action.countingType,
        clickThroughLookbackWindowDays: action.clickThroughLookbackWindowDays,
        syncedAt: now,
      },
      update: {
        name: action.name,
        status: action.status,
        type: action.type,
        category: action.category,
        countingType: action.countingType,
        clickThroughLookbackWindowDays: action.clickThroughLookbackWindowDays,
        syncedAt: now,
      },
    });
  }
  return actions.filter(isSuitableOfflineConversionAction);
}

export async function saveConversionFeedbackConfig(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  googleAdsCustomerId: string;
  conversionActionId: string;
  eventSource: GoogleAdsConversionEventSource;
  valuePolicy: GoogleAdsConversionValuePolicy;
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
      },
    }),
    database.googleAdsConnection.findUnique({
      where: { organizationId: organization.id },
    }),
  ]);
  if (!website) throw new DomainError(conversionFeedbackUserErrors.noWebsite);
  if (!customer || !connection) {
    throw new DomainError(conversionFeedbackUserErrors.noCustomer);
  }
  await assertWebsiteCustomerAlignment({
    organizationId: organization.id,
    websiteId: website.id,
    googleAdsCustomerId: customer.id,
    source: "feedback",
  });
  const capabilities = capabilitiesFromGrantedScopes(
    connection.grantedScopes,
    connection.status,
  );
  if (capabilities.dataManagerStatus !== "READY") {
    throw new DomainError(conversionFeedbackUserErrors.reauthRequired);
  }
  const cached = await database.googleAdsConversionActionCache.findUnique({
    where: {
      googleAdsCustomerId_conversionActionId: {
        googleAdsCustomerId: customer.id,
        conversionActionId: input.conversionActionId,
      },
    },
  });
  if (!cached || !isSuitableOfflineConversionAction(cached)) {
    throw new DomainError(conversionFeedbackUserErrors.noActions);
  }
  const stale =
    Date.now() - cached.syncedAt.getTime() >
    conversionEligibilityPolicy.conversionActionCacheTtlMs;
  if (stale) {
    throw new DomainError(
      "Refresh conversion actions before saving this mapping.",
    );
  }
  return database.googleAdsConversionFeedbackConfig.upsert({
    where: { websiteId: website.id },
    create: {
      organizationId: organization.id,
      websiteId: website.id,
      googleAdsConnectionId: connection.id,
      googleAdsCustomerId: customer.id,
      conversionActionId: cached.conversionActionId,
      conversionActionNameSnapshot: cached.name,
      conversionActionTypeSnapshot: cached.type,
      conversionActionCountingType: cached.countingType,
      clickThroughLookbackDays: cached.clickThroughLookbackWindowDays,
      status: "READY",
      eventSource: input.eventSource,
      valuePolicy: input.valuePolicy,
      verifiedAt: new Date(),
    },
    update: {
      googleAdsConnectionId: connection.id,
      googleAdsCustomerId: customer.id,
      conversionActionId: cached.conversionActionId,
      conversionActionNameSnapshot: cached.name,
      conversionActionTypeSnapshot: cached.type,
      conversionActionCountingType: cached.countingType,
      clickThroughLookbackDays: cached.clickThroughLookbackWindowDays,
      status: "READY",
      eventSource: input.eventSource,
      valuePolicy: input.valuePolicy,
      verifiedAt: new Date(),
      enabledAt: null,
      disabledAt: null,
      lastErrorCode: null,
    },
  });
}

export async function activateConversionFeedback(input: {
  userId: string;
  organizationSlug: string;
  configId: string;
  confirmed: boolean;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  if (!input.confirmed) {
    throw new DomainError(conversionFeedbackUserErrors.confirmEnable);
  }
  await requireFeature(organization.id, "googleAdsConversionFeedback");
  const config = await database.googleAdsConversionFeedbackConfig.findFirst({
    where: { id: input.configId, organizationId: organization.id },
    include: { connection: true },
  });
  if (!config) throw new DomainError("Conversion feedback is not configured.");
  const capabilities = capabilitiesFromGrantedScopes(
    config.connection.grantedScopes,
    config.connection.status,
  );
  if (capabilities.dataManagerStatus !== "READY") {
    throw new DomainError(conversionFeedbackUserErrors.reauthRequired);
  }
  if (config.status !== "READY" && config.status !== "DISABLED") {
    throw new DomainError("Verify conversion feedback before activating.");
  }
  return database.googleAdsConversionFeedbackConfig.update({
    where: { id: config.id },
    data: { status: "ACTIVE", enabledAt: new Date(), disabledAt: null },
  });
}

export async function disableConversionFeedback(input: {
  userId: string;
  organizationSlug: string;
  configId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const config = await database.googleAdsConversionFeedbackConfig.findFirst({
    where: { id: input.configId, organizationId: organization.id },
  });
  if (!config) throw new DomainError("Conversion feedback is not configured.");
  return database.googleAdsConversionFeedbackConfig.update({
    where: { id: config.id },
    data: { status: "DISABLED", disabledAt: new Date() },
  });
}

export async function retryConversionExportRecord(exportId: string) {
  const row = await database.googleAdsConversionExport.findUnique({
    where: { id: exportId },
  });
  if (!row) throw new DomainError("Conversion export was not found.");
  if (
    row.status !== "RETRYABLE_ERROR" &&
    row.status !== "NEEDS_REVIEW" &&
    row.status !== "BLOCKED"
  ) {
    throw new DomainError("This conversion cannot be retried.");
  }
  return database.googleAdsConversionExport.update({
    where: { id: row.id },
    data: {
      status: row.dataManagerRequestId ? "PROCESSING" : "READY",
      nextAttemptAt: new Date(),
      completedAt: null,
    },
  });
}

export async function retryConversionExport(input: {
  userId: string;
  organizationSlug: string;
  exportId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const row = await database.googleAdsConversionExport.findFirst({
    where: { id: input.exportId, organizationId: organization.id },
    select: { id: true },
  });
  if (!row) throw new DomainError("Conversion export was not found.");
  return retryConversionExportRecord(row.id);
}

export async function queueManualConversionExport(input: {
  userId: string;
  organizationSlug: string;
  leadId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const { planGoogleConversionExport } =
    await import("@/server/google-ads/conversion-export");
  return planGoogleConversionExport({
    leadId: input.leadId,
    organizationId: organization.id,
    reason: "manual",
  });
}

export async function validateConversionWithEligibleLead(input: {
  userId: string;
  organizationSlug: string;
  configId: string;
  leadId: string;
}) {
  const { organization } = await requireManage(
    input.userId,
    input.organizationSlug,
  );
  const config = await database.googleAdsConversionFeedbackConfig.findFirst({
    where: { id: input.configId, organizationId: organization.id },
    include: { connection: true, customer: true },
  });
  if (!config) throw new DomainError("Conversion feedback is not configured.");
  const lead = await database.lead.findFirst({
    where: { id: input.leadId, organizationId: organization.id },
    include: {
      outcome: true,
      attribution: { include: { primaryTouch: true } },
    },
  });
  if (
    !lead?.outcome ||
    lead.outcome.status !== "WON" ||
    !lead.attribution?.primaryTouch
  ) {
    throw new DomainError("Select an eligible Google-attributed won lead.");
  }
  const touch = lead.attribution.primaryTouch;
  const identifiers: { gclid?: string; gbraid?: string; wbraid?: string } = {};
  if (touch.hasGclid && touch.encryptedGclid) {
    identifiers.gclid = decryptClickId(touch.encryptedGclid);
  }
  if (touch.hasGbraid && touch.encryptedGbraid) {
    identifiers.gbraid = decryptClickId(touch.encryptedGbraid);
  }
  if (touch.hasWbraid && touch.encryptedWbraid) {
    identifiers.wbraid = decryptClickId(touch.encryptedWbraid);
  }
  const accessToken = await refreshGoogleConnectionAccessToken(
    config.connection,
  );
  await getGoogleConversionFeedbackProvider().ingestConversion(accessToken, {
    destination: {
      operatingAccount: {
        accountId: config.customer.googleCustomerId,
        accountType: "GOOGLE_ADS",
      },
      loginAccount: config.customer.loginCustomerId
        ? {
            accountId: config.customer.loginCustomerId,
            accountType: "GOOGLE_ADS",
          }
        : undefined,
      productDestinationId: config.conversionActionId,
    },
    event: {
      transactionId: `lgc_validate_${lead.id}`,
      eventTimestamp: (lead.outcome.wonAt ?? new Date()).toISOString(),
      eventSource: config.eventSource,
      adIdentifiers: identifiers,
    },
    validateOnly: true,
  });
  return { ok: true as const };
}

export async function getConversionFeedbackOverview(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireRead(userId, organizationSlug);
  const [connection, configs, websites, customers, counts] = await Promise.all([
    database.googleAdsConnection.findUnique({
      where: { organizationId: organization.id },
    }),
    database.googleAdsConversionFeedbackConfig.findMany({
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
    database.googleAdsConversionExport.groupBy({
      by: ["status"],
      where: { organizationId: organization.id },
      _count: { _all: true },
    }),
  ]);
  const tally = Object.fromEntries(
    counts.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;
  return {
    connection,
    configs,
    websites,
    customers,
    capabilities: capabilitiesFromGrantedScopes(
      connection?.grantedScopes,
      connection?.status ?? "DISCONNECTED",
    ),
    counts: {
      succeeded: tally.SUCCEEDED ?? 0,
      processing: (tally.PROCESSING ?? 0) + (tally.SUBMITTING ?? 0),
      needsAttention:
        (tally.NEEDS_REVIEW ?? 0) +
        (tally.REJECTED ?? 0) +
        (tally.OUT_OF_SYNC ?? 0) +
        (tally.BLOCKED ?? 0),
    },
  };
}
