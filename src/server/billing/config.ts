import { isE2eRuntime, isProductionRuntime } from "@/server/google-ads/config";
import type { BillingPlanKey } from "@/generated/prisma/enums";
import { sellablePlanKeys } from "@/server/billing/catalog";

export const stripeApiVersion = "2026-08-26.dahlia" as const;
export const billingReconcileQueue = "billing.stripe.reconcile";

export type BillingProviderKind = "stripe" | "fake";

function intEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

export function getBillingProviderKind(
  env: NodeJS.Dict<string> = process.env,
): BillingProviderKind {
  const raw = env.BILLING_PROVIDER?.trim().toLowerCase();
  if (raw === "stripe" || raw === "fake") return raw;
  if (isE2eRuntime(env) || env.NODE_ENV === "test") return "fake";
  return isProductionRuntime(env) ? "stripe" : "fake";
}

export function assertBillingProviderAllowed(
  env: NodeJS.Dict<string> = process.env,
) {
  const kind = getBillingProviderKind(env);
  if (kind === "fake" && isProductionRuntime(env)) {
    throw new Error("BILLING_PROVIDER=fake is not allowed in production.");
  }
}

const priceEnv: Record<(typeof sellablePlanKeys)[number], string> = {
  STARTER: "STRIPE_PRICE_STARTER_MONTHLY",
  GROWTH: "STRIPE_PRICE_GROWTH_MONTHLY",
  PRO: "STRIPE_PRICE_PRO_MONTHLY",
  AGENCY: "STRIPE_PRICE_AGENCY_MONTHLY",
};

export function fakePriceEnv(): NodeJS.Dict<string> {
  return {
    BILLING_PROVIDER: "fake",
    STRIPE_PRICE_STARTER_MONTHLY: "price_fake_starter",
    STRIPE_PRICE_GROWTH_MONTHLY: "price_fake_growth",
    STRIPE_PRICE_PRO_MONTHLY: "price_fake_pro",
    STRIPE_PRICE_AGENCY_MONTHLY: "price_fake_agency",
  };
}

export function stripePriceIdForPlan(
  planKey: BillingPlanKey,
  env: NodeJS.Dict<string> = process.env,
): string | null {
  if (!(planKey in priceEnv)) return null;
  const value = env[priceEnv[planKey as keyof typeof priceEnv]]?.trim();
  return value || null;
}

export function planKeyForStripePriceId(
  priceId: string,
  env: NodeJS.Dict<string> = process.env,
): BillingPlanKey | null {
  for (const key of sellablePlanKeys) {
    if (stripePriceIdForPlan(key, env) === priceId) return key;
  }
  return null;
}

export function getBillingConfig(env: NodeJS.Dict<string> = process.env) {
  const provider = getBillingProviderKind(env);
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  const webhookSecretPrevious =
    env.STRIPE_WEBHOOK_SECRET_PREVIOUS?.trim() || "";
  if (provider === "stripe" && secretKey.startsWith("sk_test_")) {
    if (
      isProductionRuntime(env) &&
      env.ALLOW_STRIPE_TEST_IN_PRODUCTION !== "true"
    ) {
      throw new Error(
        "STRIPE_SECRET_KEY is a test key; production requires sk_live.",
      );
    }
  }
  if (
    provider === "stripe" &&
    secretKey.startsWith("sk_live_") &&
    !isProductionRuntime(env)
  ) {
    throw new Error("Live Stripe keys are not allowed outside production.");
  }
  return {
    provider,
    apiVersion: stripeApiVersion,
    secretKey,
    webhookSecret,
    webhookSecrets: [webhookSecret, webhookSecretPrevious].filter(Boolean),
    publishableKey: env.STRIPE_PUBLISHABLE_KEY?.trim() || "",
    trialDays: intEnv("BILLING_TRIAL_DAYS", 14, 1, 90),
    graceDays: intEnv("BILLING_GRACE_DAYS", 3, 1, 30),
    checkoutRateLimit: intEnv("BILLING_CHECKOUT_RATE_LIMIT", 8, 1, 60),
    portalRateLimit: intEnv("BILLING_PORTAL_RATE_LIMIT", 8, 1, 60),
    webhookMaxBytes: intEnv(
      "BILLING_WEBHOOK_MAX_BYTES",
      1_048_576,
      8_192,
      2_097_152,
    ),
    reconcileIntervalSeconds: intEnv(
      "BILLING_RECONCILE_INTERVAL_SECONDS",
      86_400,
      3_600,
      604_800,
    ),
    termsUrl: env.BILLING_TERMS_URL?.trim() || "",
    privacyUrl: env.BILLING_PRIVACY_URL?.trim() || "",
    cancellationUrl: env.BILLING_CANCELLATION_URL?.trim() || "",
    displayPrices: {
      STARTER: env.BILLING_DISPLAY_PRICE_STARTER?.trim() || null,
      GROWTH: env.BILLING_DISPLAY_PRICE_GROWTH?.trim() || null,
      PRO: env.BILLING_DISPLAY_PRICE_PRO?.trim() || null,
      AGENCY: env.BILLING_DISPLAY_PRICE_AGENCY?.trim() || null,
    },
  };
}
