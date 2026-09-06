import type {
  BillingPlanKey,
  BillingSubscriptionStatus,
} from "@/generated/prisma/enums";
import {
  getPlanDefinition,
  type PlanDefinition,
  type PlanFeatures,
  type PlanLimits,
} from "@/server/billing/catalog";

export type OrganizationEntitlements = {
  planKey: BillingPlanKey | null;
  planName: string;
  status: BillingSubscriptionStatus | "NONE";
  effectiveStatus: BillingSubscriptionStatus | "NONE" | "OVER_LIMIT";
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceDeadlineAt: Date | null;
  monitoringEnabled: boolean;
  billableWriteWindow: boolean;
  canCreateBillableResources: boolean;
  overLimit: boolean;
  manualSuspended: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
};

export type EntitlementSnapshotInput = {
  planKey: BillingPlanKey | null;
  status: BillingSubscriptionStatus | null;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceDeadlineAt: Date | null;
  now: Date;
  manualSuspended?: boolean;
  usage: {
    websites: number;
    monitors: number;
    formMonitors: number;
    members: number;
    googleAdsCustomers: number;
    outcomeIntegrations: number;
  };
};

const emptyLimits: PlanLimits = {
  maxWebsites: 0,
  maxMonitors: 0,
  maxFormMonitors: 0,
  maxOrganizationMembers: 0,
  maxGoogleAdsCustomers: 0,
  maxOutcomeIntegrations: 0,
};

const emptyFeatures: PlanFeatures = {
  revenueAnalytics: false,
  googleAdsDestinationMonitoring: false,
  googleAdsConversionFeedback: false,
  csvImports: false,
  apiOutcomeIngestion: false,
  browserMonitoring: false,
  formMonitoring: false,
};

function effectiveStatus(
  input: EntitlementSnapshotInput,
): BillingSubscriptionStatus | "NONE" {
  if (!input.status) return "NONE";
  if (
    input.status === "TRIALING" &&
    input.trialEnd &&
    input.now >= input.trialEnd
  ) {
    return "TRIAL_EXPIRED";
  }
  if (
    (input.status === "PAST_DUE" || input.status === "GRACE_PERIOD") &&
    input.graceDeadlineAt
  ) {
    return input.now >= input.graceDeadlineAt ? "SUSPENDED" : "GRACE_PERIOD";
  }
  if (
    input.status === "CANCELED" &&
    input.currentPeriodEnd &&
    input.now < input.currentPeriodEnd
  ) {
    return "ACTIVE";
  }
  if (input.status === "CANCELED") return "CANCELED";
  if (input.cancelAtPeriodEnd && input.status === "ACTIVE") return "ACTIVE";
  return input.status;
}

function isOverLimit(
  limits: PlanLimits,
  usage: EntitlementSnapshotInput["usage"],
) {
  return (
    usage.websites > limits.maxWebsites ||
    usage.monitors > limits.maxMonitors ||
    usage.formMonitors > limits.maxFormMonitors ||
    usage.members > limits.maxOrganizationMembers ||
    usage.googleAdsCustomers > limits.maxGoogleAdsCustomers ||
    usage.outcomeIntegrations > limits.maxOutcomeIntegrations
  );
}

export function calculateEntitlements(
  input: EntitlementSnapshotInput,
): OrganizationEntitlements {
  const status = effectiveStatus(input);
  const plan: PlanDefinition | null = input.planKey
    ? getPlanDefinition(input.planKey)
    : null;
  const paidAccess =
    status === "TRIALING" ||
    status === "ACTIVE" ||
    status === "PAST_DUE" ||
    status === "GRACE_PERIOD";
  const limits = paidAccess && plan ? plan.limits : emptyLimits;
  const features = paidAccess && plan ? plan.features : emptyFeatures;
  const overLimit =
    paidAccess && plan ? isOverLimit(limits, input.usage) : false;
  const manualSuspended = input.manualSuspended === true;
  const monitoringEnabled = paidAccess && !manualSuspended;
  const billableWriteWindow =
    monitoringEnabled &&
    (status === "TRIALING" || status === "ACTIVE" || status === "GRACE_PERIOD");
  const canCreateBillableResources = billableWriteWindow && !overLimit;

  return {
    planKey: input.planKey,
    planName: plan?.name ?? "None",
    status: input.status ?? "NONE",
    effectiveStatus: overLimit ? "OVER_LIMIT" : status,
    trialEndsAt: input.trialEnd,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    graceDeadlineAt: input.graceDeadlineAt,
    monitoringEnabled,
    billableWriteWindow,
    canCreateBillableResources,
    overLimit,
    manualSuspended,
    limits,
    features,
  };
}

export type EntitlementOverrideInput = {
  featureKey: string | null;
  limitKey: string | null;
  booleanValue: boolean | null;
  integerValue: number | null;
  expiresAt: Date | null;
};

const limitKeys = new Set<keyof PlanLimits>([
  "maxWebsites",
  "maxMonitors",
  "maxFormMonitors",
  "maxOrganizationMembers",
  "maxGoogleAdsCustomers",
  "maxOutcomeIntegrations",
]);

const featureKeys = new Set<keyof PlanFeatures>([
  "revenueAnalytics",
  "googleAdsDestinationMonitoring",
  "googleAdsConversionFeedback",
  "csvImports",
  "apiOutcomeIngestion",
  "browserMonitoring",
  "formMonitoring",
]);

export function isLimitKey(value: string): value is keyof PlanLimits {
  return limitKeys.has(value as keyof PlanLimits);
}

export function isFeatureKey(value: string): value is keyof PlanFeatures {
  return featureKeys.has(value as keyof PlanFeatures);
}

export function applyEntitlementOverrides(
  entitlements: OrganizationEntitlements,
  overrides: EntitlementOverrideInput[],
  usage: EntitlementSnapshotInput["usage"],
  now: Date,
): OrganizationEntitlements {
  const limits = { ...entitlements.limits };
  const features = { ...entitlements.features };
  for (const override of overrides) {
    if (override.expiresAt && override.expiresAt <= now) continue;
    if (
      override.limitKey &&
      isLimitKey(override.limitKey) &&
      override.integerValue != null &&
      override.integerValue >= 0
    ) {
      limits[override.limitKey] = override.integerValue;
    }
    if (
      override.featureKey &&
      isFeatureKey(override.featureKey) &&
      override.booleanValue != null
    ) {
      features[override.featureKey] = override.booleanValue;
    }
  }
  const overLimit = isOverLimit(limits, usage);
  return {
    ...entitlements,
    limits,
    features,
    overLimit,
    canCreateBillableResources: entitlements.billableWriteWindow && !overLimit,
    effectiveStatus: overLimit
      ? "OVER_LIMIT"
      : entitlements.effectiveStatus === "OVER_LIMIT"
        ? entitlements.status
        : entitlements.effectiveStatus,
  };
}

export function canUseFeature(
  entitlements: OrganizationEntitlements,
  feature: keyof PlanFeatures,
): boolean {
  return entitlements.features[feature] === true;
}

export type LimitResource =
  | "websites"
  | "monitors"
  | "formMonitors"
  | "members"
  | "googleAdsCustomers"
  | "outcomeIntegrations";

export function limitForResource(
  limits: PlanLimits,
  resource: LimitResource,
): number {
  switch (resource) {
    case "websites":
      return limits.maxWebsites;
    case "monitors":
      return limits.maxMonitors;
    case "formMonitors":
      return limits.maxFormMonitors;
    case "members":
      return limits.maxOrganizationMembers;
    case "googleAdsCustomers":
      return limits.maxGoogleAdsCustomers;
    case "outcomeIntegrations":
      return limits.maxOutcomeIntegrations;
  }
}
