import { database } from "@/server/database";

export type PlanUsage = {
  websites: number;
  monitors: number;
  formMonitors: number;
  members: number;
  googleAdsCustomers: number;
  outcomeIntegrations: number;
};

export async function getOrganizationUsage(
  organizationId: string,
  client: Pick<
    typeof database,
    | "website"
    | "monitor"
    | "organizationMember"
    | "googleAdsCustomer"
    | "externalOutcomeIntegration"
  > = database,
): Promise<PlanUsage> {
  const websites = await client.website.count({
    where: { organizationId, status: "ACTIVE" },
  });
  const monitors = await client.monitor.count({
    where: {
      deletedAt: null,
      website: { organizationId },
    },
  });
  const formMonitors = await client.monitor.count({
    where: {
      deletedAt: null,
      type: "FORM",
      website: { organizationId },
    },
  });
  const members = await client.organizationMember.count({
    where: { organizationId },
  });
  const googleAdsCustomers = await client.googleAdsCustomer.count({
    where: { organizationId, selected: true, isManager: false },
  });
  const outcomeIntegrations = await client.externalOutcomeIntegration.count({
    where: { organizationId, status: "ENABLED" },
  });
  return {
    websites,
    monitors,
    formMonitors,
    members,
    googleAdsCustomers,
    outcomeIntegrations,
  };
}
