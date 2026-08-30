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

export const allowedBrowserMonitorIntervals = [600, 900, 1800, 3600] as const;
export type BrowserMonitorIntervalSeconds =
  (typeof allowedBrowserMonitorIntervals)[number];

export const browserCheckQueue = "monitor.browser.check";

export function getBrowserMonitoringConfig() {
  const minIntervalSeconds = intEnv(
    "BROWSER_MONITOR_MIN_INTERVAL_SECONDS",
    600,
    300,
    3600,
  );
  const defaultIntervalSeconds = intEnv(
    "BROWSER_MONITOR_DEFAULT_INTERVAL_SECONDS",
    600,
    minIntervalSeconds,
    3600,
  );
  return {
    minIntervalSeconds,
    defaultIntervalSeconds,
    allowedIntervals: allowedBrowserMonitorIntervals.filter(
      (interval) => interval >= minIntervalSeconds,
    ),
    minTimeoutMs: 5_000,
    defaultTimeoutMs: intEnv(
      "BROWSER_MONITOR_DEFAULT_TIMEOUT_MS",
      20_000,
      5_000,
      45_000,
    ),
    maxTimeoutMs: intEnv(
      "BROWSER_MONITOR_MAX_TIMEOUT_MS",
      45_000,
      5_000,
      45_000,
    ),
    stabilizeMs: intEnv("BROWSER_STABILIZE_MS", 800, 0, 5_000),
    degradedLatencyMs: intEnv("BROWSER_DEGRADED_MS", 10_000, 3_000, 45_000),
    workerConcurrency: intEnv("BROWSER_WORKER_CONCURRENCY", 2, 1, 8),
    recycleAfterChecks: intEnv("BROWSER_RECYCLE_AFTER_CHECKS", 50, 5, 500),
    maxConsoleErrors: 20,
    maxFailedResources: 8,
    maxJavascriptErrors: 10,
    screenshotQuality: 52,
    maxScreenshotBytes: 1_200_000,
    maxResourceBytes: 15 * 1024 * 1024,
    artifactRetentionDays: intEnv("ARTIFACT_RETENTION_DAYS", 30, 1, 365),
    jobRetryLimit: 2,
    jobRetryDelaySeconds: 10,
    chromiumSandbox: process.env.PLAYWRIGHT_CHROMIUM_SANDBOX !== "false",
  };
}
