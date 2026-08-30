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

export const allowedFormMonitorIntervals = [3600, 21600, 43200, 86400] as const;
export type FormMonitorIntervalSeconds =
  (typeof allowedFormMonitorIntervals)[number];

export const formCheckQueue = "monitor.form.check";
export const formConsentVersion = "form-submit-v1";

export function getFormMonitoringConfig() {
  const minIntervalSeconds = intEnv(
    "FORM_MONITOR_MIN_INTERVAL_SECONDS",
    3600,
    3600,
    86400,
  );
  const defaultIntervalSeconds = intEnv(
    "FORM_MONITOR_DEFAULT_INTERVAL_SECONDS",
    21600,
    minIntervalSeconds,
    86400,
  );
  return {
    minIntervalSeconds,
    defaultIntervalSeconds,
    allowedIntervals: allowedFormMonitorIntervals.filter(
      (interval) => interval >= minIntervalSeconds,
    ),
    minTimeoutMs: 5_000,
    defaultTimeoutMs: intEnv(
      "FORM_MONITOR_DEFAULT_TIMEOUT_MS",
      30_000,
      5_000,
      45_000,
    ),
    maxTimeoutMs: intEnv("FORM_MONITOR_MAX_TIMEOUT_MS", 45_000, 5_000, 45_000),
    minSubmissionTimeoutMs: 5_000,
    defaultSubmissionTimeoutMs: intEnv(
      "FORM_MONITOR_SUBMISSION_TIMEOUT_MS",
      20_000,
      5_000,
      30_000,
    ),
    maxSubmissionTimeoutMs: 30_000,
    workerConcurrency: intEnv("FORM_WORKER_CONCURRENCY", 1, 1, 4),
    manualCooldownMs: intEnv(
      "FORM_MANUAL_COOLDOWN_MS",
      5 * 60_000,
      30_000,
      60 * 60_000,
    ),
    maxPerOrganization: intEnv("FORM_MONITOR_MAX_PER_ORGANIZATION", 20, 1, 500),
    jobRetryLimit: 2,
    jobRetryDelaySeconds: 15,
    expireInSeconds: 240,
    consentVersion: formConsentVersion,
  };
}
