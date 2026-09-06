import {
  getGoogleAdsProviderKind,
  isE2eRuntime,
} from "@/server/google-ads/config";

export const googleDataManagerApiVersion = "v1";
export const googleDataManagerBaseUrl = "https://datamanager.googleapis.com/v1";
export const googleDataManagerOAuthScope =
  "https://www.googleapis.com/auth/datamanager";
export const googleAdsOAuthScope = "https://www.googleapis.com/auth/adwords";

export const googleConversionPlanQueue = "google_ads.conversion.plan";
export const googleConversionSubmitQueue = "google_ads.conversion.submit";
export const googleConversionStatusQueue = "google_ads.conversion.status";

/**
 * Eligibility and polling limits sourced from official Google Ads / Data Manager
 * docs as of 31 Aug 2026. Do not scatter magic lookback numbers in business logic.
 *
 * Click-through lookback: Google Ads API v25 field
 * `conversion_action.click_through_lookback_window_days` (typical maximum 90).
 * Processing: Data Manager diagnostics may take up to 24 hours
 * (https://developers.google.com/data-manager/api/devguides/diagnostics).
 */
export const conversionEligibilityPolicy = {
  fallbackClickThroughLookbackDays: 90,
  futureSkewMs: 5 * 60 * 1000,
  tooRecentClickMaxAttempts: 6,
  tooRecentClickBaseDelayMs: 60 * 60 * 1000,
  clickNotFoundMaxAttempts: 4,
  clickNotFoundBaseDelayMs: 30 * 60 * 1000,
  processingPollHorizonMs: 24 * 60 * 60 * 1000,
  conversionActionCacheTtlMs: 6 * 60 * 60 * 1000,
} as const;

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

export function getGoogleDataManagerConfig() {
  const provider = getGoogleAdsProviderKind();
  return {
    provider,
    apiVersion: googleDataManagerApiVersion,
    baseUrl: googleDataManagerBaseUrl,
    oauthScope: googleDataManagerOAuthScope,
    workerConcurrency: intEnv("GOOGLE_CONVERSION_WORKER_CONCURRENCY", 5, 1, 20),
    statusPollInitialSeconds: intEnv(
      "GOOGLE_CONVERSION_STATUS_POLL_INTERVAL_SECONDS",
      30,
      0,
      3_600,
    ),
    statusPollMaxSeconds: intEnv(
      "GOOGLE_CONVERSION_STATUS_POLL_MAX_SECONDS",
      1_800,
      30,
      86_400,
    ),
    maxRetries: intEnv("GOOGLE_CONVERSION_MAX_RETRIES", 8, 1, 20),
    jobRetryDelaySeconds: intEnv(
      "GOOGLE_CONVERSION_JOB_RETRY_DELAY_SECONDS",
      30,
      1,
      3_600,
    ),
    expireInSeconds: 900,
    schedulerBatchSize: 20,
  };
}

export function assertFakeDataManagerNotUsedInProduction(
  runtime = process.env.NODE_ENV,
  env: NodeJS.Dict<string> = process.env,
): void {
  if (isE2eRuntime(env)) return;
  if (getGoogleAdsProviderKind() === "fake" && runtime === "production") {
    throw new Error("Fake Data Manager provider is not allowed in production.");
  }
}
