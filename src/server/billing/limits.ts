import { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/server/authorization/errors";
import type { LimitResource } from "@/server/billing/entitlements";
import {
  applyEntitlementOverrides,
  calculateEntitlements,
  limitForResource,
  type OrganizationEntitlements,
} from "@/server/billing/entitlements";
import { getOrganizationUsage } from "@/server/billing/usage";
import { database } from "@/server/database";
import { lockOrganizationBilling } from "@/server/billing/lock";

export class PlanLimitError extends DomainError {
  readonly resource: LimitResource;
  readonly used: number;
  readonly included: number;

  constructor(resource: LimitResource, used: number, included: number) {
    super(
      `You've reached your plan limit of ${included} ${resourceLabel(resource)}. Upgrade your plan to add more.`,
    );
    this.name = "PlanLimitError";
    this.resource = resource;
    this.used = used;
    this.included = included;
  }
}

export class BillingAccessError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "BillingAccessError";
  }
}

function resourceLabel(resource: LimitResource): string {
  switch (resource) {
    case "websites":
      return "websites";
    case "monitors":
      return "monitors";
    case "formMonitors":
      return "form monitors";
    case "members":
      return "team members";
    case "googleAdsCustomers":
      return "Google Ads accounts";
    case "outcomeIntegrations":
      return "outcome integrations";
  }
}

async function ensureTestBillingSubscription(
  organizationId: string,
  client: Prisma.TransactionClient | typeof database,
) {
  if (process.env.NODE_ENV !== "test" || process.env.E2E_RUNTIME === "true") {
    return;
  }
  const existing = await client.billingSubscription.findUnique({
    where: { organizationId },
    select: { id: true },
  });
  if (existing) return;
  try {
    await client.billingSubscription.create({
      data: {
        organizationId,
        provider: "INTERNAL",
        providerSubscriptionId: `test-legacy:${organizationId}`,
        planKey: "LEGACY",
        status: "ACTIVE",
        providerStatus: "test",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date("2099-12-31T23:59:59.000Z"),
      },
    });
  } catch (error) {
    if (!(
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )) {
      throw error;
    }
  }
}

async function loadActiveOverrides(
  organizationId: string,
  now: Date,
  client: Prisma.TransactionClient | typeof database,
) {
  return client.organizationEntitlementOverride.findMany({
    where: {
      organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
}

export async function loadEntitlements(
  organizationId: string,
  now = new Date(),
  client: Prisma.TransactionClient | typeof database = database,
): Promise<OrganizationEntitlements> {
  await ensureTestBillingSubscription(organizationId, client);
  const [subscription, usage, organization, overrides] = await Promise.all([
    client.billingSubscription.findUnique({
      where: { organizationId },
    }),
    getOrganizationUsage(organizationId, client as typeof database),
    client.organization.findUnique({
      where: { id: organizationId },
      select: { manualSuspendedAt: true },
    }),
    loadActiveOverrides(organizationId, now, client),
  ]);
  const base = calculateEntitlements({
    planKey: subscription?.planKey ?? null,
    status: subscription?.status ?? null,
    trialEnd: subscription?.trialEnd ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    graceDeadlineAt: subscription?.graceDeadlineAt ?? null,
    now,
    usage,
    manualSuspended: Boolean(organization?.manualSuspendedAt),
  });
  return applyEntitlementOverrides(base, overrides, usage, now);
}

export async function requireCapacity(
  organizationId: string,
  resource: LimitResource,
  additional = 1,
  client: Prisma.TransactionClient | typeof database = database,
) {
  if ("$executeRaw" in client) {
    await lockOrganizationBilling(
      client as Prisma.TransactionClient,
      organizationId,
    );
  }
  await ensureTestBillingSubscription(organizationId, client);
  const entitlements = await loadEntitlements(
    organizationId,
    new Date(),
    client,
  );
  if (!entitlements.monitoringEnabled) {
    throw new BillingAccessError(
      entitlements.manualSuspended
        ? "This organization is suspended."
        : entitlements.effectiveStatus === "SUSPENDED"
          ? "Monitoring suspended because subscription payment is overdue."
          : "Your trial or subscription is not active. Upgrade to continue.",
    );
  }
  const usage = await getOrganizationUsage(
    organizationId,
    client as typeof database,
  );
  if (!entitlements.canCreateBillableResources || entitlements.overLimit) {
    const used = usage[resource];
    throw new PlanLimitError(
      resource,
      used,
      limitForResource(entitlements.limits, resource),
    );
  }
  const used = usage[resource];
  const included = limitForResource(entitlements.limits, resource);
  if (used + additional > included) {
    throw new PlanLimitError(resource, used, included);
  }
  return entitlements;
}

export async function requireFeature(
  organizationId: string,
  feature: keyof OrganizationEntitlements["features"],
) {
  const entitlements = await loadEntitlements(organizationId);
  if (!entitlements.features[feature]) {
    throw new BillingAccessError(
      `Available on a paid LeadGuard plan. Upgrade to use this feature.`,
    );
  }
  if (!entitlements.monitoringEnabled) {
    throw new BillingAccessError(
      entitlements.manualSuspended
        ? "This organization is suspended."
        : entitlements.effectiveStatus === "SUSPENDED"
          ? "Monitoring suspended because subscription payment is overdue."
          : "Your trial or subscription is not active. Upgrade to continue.",
    );
  }
  return entitlements;
}
