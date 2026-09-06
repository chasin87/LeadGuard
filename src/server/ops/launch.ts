import { isE2eRuntime, isProductionRuntime } from "@/server/google-ads/config";
import {
  getBillingConfig,
  getBillingProviderKind,
  stripePriceIdForPlan,
} from "@/server/billing/config";
import { sellablePlanKeys } from "@/server/billing/catalog";

export type LaunchCheckItem = {
  id: string;
  ok: boolean;
  required: boolean;
  message: string;
};

const weakSecrets = [
  "replace-with-at-least-32-random-characters",
  "change-me",
  "leadguard-dev-only-credential-encryption-key",
  "test-secret",
  "password",
];

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isWeakSecret(value: string | undefined): boolean {
  const raw = value?.trim() ?? "";
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return weakSecrets.some((item) => lower.includes(item));
}

function looksLikeEncryptionKey(value: string | undefined): boolean {
  const raw = value?.trim() ?? "";
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

export function evaluateLaunchReadiness(
  env: NodeJS.Dict<string> = process.env,
): LaunchCheckItem[] {
  const production = isProductionRuntime(env);
  const e2e = isE2eRuntime(env);
  const billing = getBillingConfig(env);
  const provider = getBillingProviderKind(env);
  const appUrl = env.APP_URL?.trim() || "";
  const items: LaunchCheckItem[] = [
    {
      id: "node_env",
      ok: production || e2e || env.NODE_ENV !== "production",
      required: true,
      message: production
        ? "NODE_ENV=production"
        : e2e
          ? "E2E runtime (production launch checks skipped)"
          : `NODE_ENV=${env.NODE_ENV ?? "unset"}`,
    },
    {
      id: "app_url",
      ok: production ? isHttpsUrl(appUrl) : present(appUrl) || !production,
      required: production,
      message: production
        ? isHttpsUrl(appUrl)
          ? `APP_URL is HTTPS (${appUrl})`
          : "APP_URL must be canonical HTTPS in production"
        : "APP_URL is optional outside production",
    },
    {
      id: "database",
      ok: Boolean(env.DATABASE_URL?.startsWith("postgresql://")),
      required: true,
      message: env.DATABASE_URL?.startsWith("postgresql://")
        ? "DATABASE_URL is PostgreSQL"
        : "DATABASE_URL must be a postgresql:// URL",
    },
    {
      id: "auth_secret",
      ok: Boolean(
        env.AUTH_SECRET &&
        env.AUTH_SECRET.length >= 32 &&
        !isWeakSecret(env.AUTH_SECRET),
      ),
      required: true,
      message:
        env.AUTH_SECRET &&
        env.AUTH_SECRET.length >= 32 &&
        !isWeakSecret(env.AUTH_SECRET)
          ? "AUTH_SECRET looks unique"
          : "AUTH_SECRET must be a unique 32+ character secret",
    },
    {
      id: "encryption_key",
      ok: !production || looksLikeEncryptionKey(env.CREDENTIAL_ENCRYPTION_KEY),
      required: production,
      message: production
        ? looksLikeEncryptionKey(env.CREDENTIAL_ENCRYPTION_KEY)
          ? "CREDENTIAL_ENCRYPTION_KEY is 32 bytes"
          : "CREDENTIAL_ENCRYPTION_KEY must be 32-byte hex or base64"
        : "CREDENTIAL_ENCRYPTION_KEY optional in development fake mode",
    },
    {
      id: "smtp",
      ok: !production || Boolean(env.SMTP_HOST && env.EMAIL_FROM),
      required: production,
      message:
        env.SMTP_HOST && env.EMAIL_FROM
          ? "SMTP is configured"
          : "SMTP_HOST and EMAIL_FROM are required in production",
    },
    {
      id: "artifacts",
      ok: !production || env.ARTIFACT_STORAGE_DRIVER === "s3",
      required: production,
      message:
        env.ARTIFACT_STORAGE_DRIVER === "s3"
          ? "Private S3 artifact storage configured"
          : "Production should use ARTIFACT_STORAGE_DRIVER=s3",
    },
    {
      id: "google_oauth",
      ok:
        !production ||
        Boolean(
          env.GOOGLE_ADS_CLIENT_ID &&
          env.GOOGLE_ADS_CLIENT_SECRET &&
          env.GOOGLE_ADS_DEVELOPER_TOKEN,
        ),
      required: production,
      message: production
        ? env.GOOGLE_ADS_CLIENT_ID &&
          env.GOOGLE_ADS_CLIENT_SECRET &&
          env.GOOGLE_ADS_DEVELOPER_TOKEN
          ? "Google Ads OAuth + developer token configured"
          : "Google Ads OAuth client and developer token are required"
        : "Google Ads live credentials optional in development",
    },
    {
      id: "google_provider",
      ok: env.GOOGLE_ADS_PROVIDER !== "fake" || !production,
      required: production,
      message:
        env.GOOGLE_ADS_PROVIDER === "fake" && production
          ? "GOOGLE_ADS_PROVIDER=fake is forbidden in production"
          : "Google Ads provider is not fake",
    },
    {
      id: "billing_provider",
      ok: provider !== "fake" || !production,
      required: production,
      message:
        provider === "fake" && production
          ? "BILLING_PROVIDER=fake is forbidden in production"
          : `Billing provider is ${provider}`,
    },
    {
      id: "stripe_secret",
      ok: provider !== "stripe" || Boolean(billing.secretKey),
      required: provider === "stripe",
      message: billing.secretKey
        ? billing.secretKey.startsWith("sk_live_")
          ? "Stripe live secret key present"
          : "Stripe secret key present"
        : "STRIPE_SECRET_KEY is required for Stripe billing",
    },
    {
      id: "stripe_webhook",
      ok: provider !== "stripe" || Boolean(billing.webhookSecret),
      required: provider === "stripe",
      message: billing.webhookSecret
        ? "Stripe webhook secret present"
        : "STRIPE_WEBHOOK_SECRET is required for Stripe billing",
    },
  ];

  for (const key of sellablePlanKeys) {
    const priceId = stripePriceIdForPlan(key, env);
    items.push({
      id: `price_${key.toLowerCase()}`,
      ok: provider !== "stripe" || Boolean(priceId),
      required: provider === "stripe",
      message: priceId
        ? `${key} maps to a Stripe Price ID`
        : `STRIPE_PRICE_${key}_MONTHLY is required for Stripe billing`,
    });
  }

  if (production && billing.secretKey.startsWith("sk_test_")) {
    items.push({
      id: "stripe_mode_mix",
      ok: env.ALLOW_STRIPE_TEST_IN_PRODUCTION === "true",
      required: true,
      message: "Test Stripe key is not allowed in production",
    });
  }
  if (!production && billing.secretKey.startsWith("sk_live_")) {
    items.push({
      id: "stripe_live_outside_prod",
      ok: false,
      required: true,
      message: "Live Stripe keys are not allowed outside production",
    });
  }

  return items;
}

export function launchReadinessFailed(items: LaunchCheckItem[]): boolean {
  return items.some((item) => item.required && !item.ok);
}
