import { database } from "@/server/database";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { loadEntitlements } from "@/server/billing/limits";
import { getOrganizationUsage } from "@/server/billing/usage";
import { getBillingConfig } from "@/server/billing/config";
import { planCatalog, sellablePlanKeys } from "@/server/billing/catalog";
import { getBillingProvider } from "@/server/billing/clients";

export async function getBillingOverview(
  userId: string,
  organizationSlug: string,
) {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "billing:read",
  );
  const [subscription, usage, customer, entitlements] = await Promise.all([
    database.billingSubscription.findUnique({
      where: { organizationId: context.organization.id },
    }),
    getOrganizationUsage(context.organization.id),
    database.billingCustomer.findUnique({
      where: { organizationId: context.organization.id },
    }),
    loadEntitlements(context.organization.id),
  ]);
  const config = getBillingConfig();
  const plans = sellablePlanKeys.map((key) => ({
    ...planCatalog[key],
    displayPrice: config.displayPrices[key],
  }));
  return {
    organization: context.organization,
    role: context.membership.role,
    subscription,
    customer,
    usage,
    entitlements,
    plans,
    config: {
      trialDays: config.trialDays,
      graceDays: config.graceDays,
      termsUrl: config.termsUrl,
      privacyUrl: config.privacyUrl,
      cancellationUrl: config.cancellationUrl,
      provider: config.provider,
    },
  };
}

export async function getCheckoutConfirmation(
  userId: string,
  organizationSlug: string,
  sessionId: string | null,
) {
  const overview = await getBillingOverview(userId, organizationSlug);
  let sessionStatus: string | null = null;
  if (sessionId) {
    const session =
      await getBillingProvider().retrieveCheckoutSession(sessionId);
    sessionStatus = session?.status ?? null;
  }
  const confirmed =
    overview.entitlements.status === "ACTIVE" ||
    overview.entitlements.status === "TRIALING";
  return { ...overview, sessionStatus, confirmed };
}
