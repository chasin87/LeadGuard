export const googleAdsApiVersion = "v25";
export const googleAdsOAuthScope = "https://www.googleapis.com/auth/adwords";
export const googleAdsAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
export const googleAdsTokenUrl = "https://oauth2.googleapis.com/token";
export const googleAdsRevokeUrl = "https://oauth2.googleapis.com/revoke";
export const googleAdsApiBaseUrl = `https://googleads.googleapis.com/${googleAdsApiVersion}`;

export const googleAdsSyncQueue = "integration.google_ads.sync";
export const googleAdsImpactQueue = "integration.google_ads.incident_impact";
export const googleAdsAnalyticsSyncQueue = "google_ads.analytics.sync";
export const googleAdsAnalyticsBackfillQueue = "google_ads.analytics.backfill";
export const googleAdsClickAttributionQueue =
  "google_ads.click_attribution.resolve";

export type GoogleAdsProviderKind = "fake" | "google";

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

export function isE2eRuntime(env: NodeJS.Dict<string> = process.env): boolean {
  return env.E2E_RUNTIME === "true";
}

export function isProductionRuntime(
  env: NodeJS.Dict<string> = process.env,
): boolean {
  if (isE2eRuntime(env)) return false;
  return env.NODE_ENV === "production";
}

export function getGoogleAdsProviderKind(): GoogleAdsProviderKind {
  const raw = process.env.GOOGLE_ADS_PROVIDER?.trim().toLowerCase();
  if (raw === "fake" || raw === "google") return raw;
  return isProductionRuntime() ? "google" : "fake";
}

export function getGoogleAdsConfig() {
  const provider = getGoogleAdsProviderKind();
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return {
    provider,
    apiVersion: googleAdsApiVersion,
    oauthScope: googleAdsOAuthScope,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID?.trim() || "",
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() || "",
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || "",
    redirectUri:
      process.env.GOOGLE_ADS_REDIRECT_URI?.trim() ||
      `${appUrl}/api/integrations/google-ads/callback`,
    syncIntervalSeconds: intEnv(
      "GOOGLE_ADS_SYNC_INTERVAL_SECONDS",
      900,
      300,
      86_400,
    ),
    observedLookbackDays: intEnv(
      "GOOGLE_ADS_OBSERVED_URL_LOOKBACK_DAYS",
      30,
      1,
      90,
    ),
    manualSyncCooldownSeconds: intEnv(
      "GOOGLE_ADS_MANUAL_SYNC_COOLDOWN_SECONDS",
      60,
      15,
      3_600,
    ),
    oauthStateTtlSeconds: 600,
    observedUrlCap: 5_000,
    searchPageSize: 1_000,
    upsertBatchSize: 100,
    customerClientMaxLevel: 2,
    jobRetryLimit: 4,
    jobRetryDelaySeconds: 30,
    expireInSeconds: 900,
    schedulerBatchSize: 20,
    impactRefreshIntervalSeconds: intEnv(
      "GOOGLE_ADS_IMPACT_REFRESH_INTERVAL_SECONDS",
      900,
      300,
      86_400,
    ),
    impactFinalizeDelayMinutes: intEnv(
      "GOOGLE_ADS_IMPACT_FINALIZE_DELAY_MINUTES",
      360,
      30,
      10_080,
    ),
    impactReconcileAfterHours: intEnv(
      "GOOGLE_ADS_IMPACT_RECONCILE_AFTER_HOURS",
      24,
      1,
      168,
    ),
    impactManualRefreshCooldownSeconds: intEnv(
      "GOOGLE_ADS_IMPACT_MANUAL_REFRESH_COOLDOWN_SECONDS",
      60,
      15,
      3_600,
    ),
    impactHourlyLookbackDays: intEnv(
      "GOOGLE_ADS_IMPACT_HOURLY_LOOKBACK_DAYS",
      90,
      7,
      180,
    ),
    impactIdChunkSize: 80,
    analyticsSyncIntervalSeconds: intEnv(
      "GOOGLE_ADS_ANALYTICS_SYNC_INTERVAL_SECONDS",
      900,
      300,
      86_400,
    ),
    analyticsRecentRefreshDays: intEnv(
      "GOOGLE_ADS_ANALYTICS_RECENT_REFRESH_DAYS",
      7,
      1,
      30,
    ),
    analyticsPeriodicRefreshDays: intEnv(
      "GOOGLE_ADS_ANALYTICS_PERIODIC_REFRESH_DAYS",
      30,
      7,
      90,
    ),
    analyticsDefaultBackfillDays: intEnv(
      "GOOGLE_ADS_ANALYTICS_DEFAULT_BACKFILL_DAYS",
      90,
      1,
      365,
    ),
    analyticsMaxBackfillDays: intEnv(
      "GOOGLE_ADS_ANALYTICS_MAX_BACKFILL_DAYS",
      365,
      90,
      1110,
    ),
    analyticsDailyLookbackMonths: 37,
    analyticsManualRefreshCooldownSeconds: intEnv(
      "GOOGLE_ADS_ANALYTICS_MANUAL_REFRESH_COOLDOWN_SECONDS",
      60,
      15,
      3_600,
    ),
    analyticsBackfillCooldownSeconds: intEnv(
      "GOOGLE_ADS_ANALYTICS_BACKFILL_COOLDOWN_SECONDS",
      3_600,
      300,
      86_400,
    ),
    analyticsWorkerConcurrency: intEnv(
      "GOOGLE_ADS_ANALYTICS_WORKER_CONCURRENCY",
      1,
      1,
      2,
    ),
    clickViewLookbackDays: 90,
    clickViewBatchSize: intEnv("GOOGLE_ADS_CLICK_VIEW_BATCH_SIZE", 50, 1, 200),
    clickResolveRetryLimit: intEnv(
      "GOOGLE_ADS_CLICK_RESOLVE_RETRY_LIMIT",
      4,
      1,
      8,
    ),
    clickResolveRetryDelaySeconds: intEnv(
      "GOOGLE_ADS_CLICK_RESOLVE_RETRY_DELAY_SECONDS",
      900,
      60,
      21_600,
    ),
    analyticsSpendDelayedAfterHours: intEnv(
      "GOOGLE_ADS_ANALYTICS_SPEND_DELAYED_AFTER_HOURS",
      3,
      1,
      24,
    ),
    analyticsSpendStaleAfterHours: intEnv(
      "GOOGLE_ADS_ANALYTICS_SPEND_STALE_AFTER_HOURS",
      24,
      6,
      168,
    ),
    analyticsCohortMaturityDays: intEnv(
      "GOOGLE_ADS_ANALYTICS_COHORT_MATURITY_DAYS",
      14,
      1,
      90,
    ),
  };
}

export function assertFakeProviderNotUsedInProduction(
  runtime = process.env.NODE_ENV,
  env: NodeJS.Dict<string> = process.env,
): void {
  if (isE2eRuntime(env)) return;
  if (getGoogleAdsProviderKind() === "fake" && runtime === "production") {
    throw new Error("GOOGLE_ADS_PROVIDER=fake is not allowed in production.");
  }
}
