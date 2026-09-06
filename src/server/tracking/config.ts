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

export function getTrackingConfig() {
  const appUrl = (
    process.env.TRACKING_PUBLIC_BASE_URL?.trim() ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return {
    publicBaseUrl: appUrl,
    sdkPath: "/tracker/v1.js",
    eventsPath: "/api/tracking/v1/events",
    leadsPath: "/api/tracking/v1/leads",
    defaultAttributionWindowDays: intEnv(
      "TRACKING_DEFAULT_ATTRIBUTION_WINDOW_DAYS",
      90,
      1,
      365,
    ),
    defaultSessionTimeoutMinutes: intEnv(
      "TRACKING_DEFAULT_SESSION_TIMEOUT_MINUTES",
      30,
      5,
      240,
    ),
    maxAttributionWindowDays: 365,
    minAttributionWindowDays: 1,
    maxSessionTimeoutMinutes: 240,
    minSessionTimeoutMinutes: 5,
    maxBodyBytes: 64 * 1024,
    maxBatchEvents: 20,
    publicEventRateLimit: intEnv("TRACKING_EVENT_RATE_LIMIT", 60, 10, 600),
    publicEventRateWindowMs: 60_000,
    serverLeadRateLimit: intEnv("TRACKING_SERVER_LEAD_RATE_LIMIT", 30, 5, 300),
    serverLeadRateWindowMs: 60_000,
    siteKeyRotationGraceMinutes: 24 * 60,
    reconciliationMinutes: 2,
    retentionBatchSize: 500,
    clientOccurredAtSkewMs: 5 * 60 * 1000,
  };
}

export function trackingSdkUrl(
  baseUrl = getTrackingConfig().publicBaseUrl,
): string {
  return `${baseUrl}${getTrackingConfig().sdkPath}`;
}
