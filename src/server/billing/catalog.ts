import type { BillingPlanKey } from "@/generated/prisma/enums";

export type PlanLimits = {
  maxWebsites: number;
  maxMonitors: number;
  maxFormMonitors: number;
  maxOrganizationMembers: number;
  maxGoogleAdsCustomers: number;
  maxOutcomeIntegrations: number;
};

export type PlanFeatures = {
  revenueAnalytics: boolean;
  googleAdsDestinationMonitoring: boolean;
  googleAdsConversionFeedback: boolean;
  csvImports: boolean;
  apiOutcomeIngestion: boolean;
  browserMonitoring: boolean;
  formMonitoring: boolean;
};

export type PlanDefinition = {
  key: BillingPlanKey;
  name: string;
  public: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
};

const coreFeatures: PlanFeatures = {
  revenueAnalytics: true,
  googleAdsDestinationMonitoring: true,
  googleAdsConversionFeedback: true,
  csvImports: true,
  apiOutcomeIngestion: true,
  browserMonitoring: true,
  formMonitoring: true,
};

export const sellablePlanKeys = [
  "STARTER",
  "GROWTH",
  "PRO",
  "AGENCY",
] as const satisfies readonly BillingPlanKey[];

export const planCatalog: Record<BillingPlanKey, PlanDefinition> = {
  STARTER: {
    key: "STARTER",
    name: "Starter",
    public: true,
    limits: {
      maxWebsites: 1,
      maxMonitors: 5,
      maxFormMonitors: 1,
      maxOrganizationMembers: 2,
      maxGoogleAdsCustomers: 1,
      maxOutcomeIntegrations: 1,
    },
    features: coreFeatures,
  },
  GROWTH: {
    key: "GROWTH",
    name: "Growth",
    public: true,
    limits: {
      maxWebsites: 5,
      maxMonitors: 25,
      maxFormMonitors: 5,
      maxOrganizationMembers: 5,
      maxGoogleAdsCustomers: 3,
      maxOutcomeIntegrations: 3,
    },
    features: coreFeatures,
  },
  PRO: {
    key: "PRO",
    name: "Pro",
    public: true,
    limits: {
      maxWebsites: 15,
      maxMonitors: 100,
      maxFormMonitors: 20,
      maxOrganizationMembers: 15,
      maxGoogleAdsCustomers: 10,
      maxOutcomeIntegrations: 10,
    },
    features: coreFeatures,
  },
  AGENCY: {
    key: "AGENCY",
    name: "Agency",
    public: true,
    limits: {
      maxWebsites: 50,
      maxMonitors: 400,
      maxFormMonitors: 80,
      maxOrganizationMembers: 40,
      maxGoogleAdsCustomers: 40,
      maxOutcomeIntegrations: 40,
    },
    features: coreFeatures,
  },
  LEGACY: {
    key: "LEGACY",
    name: "Legacy",
    public: false,
    limits: {
      maxWebsites: 50,
      maxMonitors: 400,
      maxFormMonitors: 80,
      maxOrganizationMembers: 40,
      maxGoogleAdsCustomers: 40,
      maxOutcomeIntegrations: 40,
    },
    features: coreFeatures,
  },
};

export function getPlanDefinition(key: BillingPlanKey): PlanDefinition {
  return planCatalog[key];
}

export function isSellablePlanKey(value: string): value is BillingPlanKey {
  return (sellablePlanKeys as readonly string[]).includes(value);
}
