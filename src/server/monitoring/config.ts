import { SOFT404_MAX_BODY_BYTES } from "@/server/monitoring/soft404/config";

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

export const allowedMonitorIntervals = [300, 900, 1800, 3600] as const;
export type MonitorIntervalSeconds = (typeof allowedMonitorIntervals)[number];

export function getMonitoringConfig() {
  const minIntervalSeconds = intEnv(
    "MONITOR_MIN_INTERVAL_SECONDS",
    300,
    60,
    3600,
  );
  const defaultIntervalSeconds = intEnv(
    "MONITOR_DEFAULT_INTERVAL_SECONDS",
    300,
    minIntervalSeconds,
    3600,
  );
  return {
    minIntervalSeconds,
    defaultIntervalSeconds,
    allowedIntervals: allowedMonitorIntervals.filter(
      (interval) => interval >= minIntervalSeconds,
    ),
    minTimeoutMs: 1_000,
    defaultTimeoutMs: intEnv(
      "MONITOR_DEFAULT_TIMEOUT_MS",
      10_000,
      1_000,
      30_000,
    ),
    maxTimeoutMs: intEnv("MONITOR_MAX_TIMEOUT_MS", 30_000, 1_000, 30_000),
    maxRedirects: intEnv("MONITOR_MAX_REDIRECTS", 10, 1, 20),
    degradedLatencyMs: 5_000,
    maxResponseBytes: SOFT404_MAX_BODY_BYTES,
    workerConcurrency: intEnv("MONITOR_WORKER_CONCURRENCY", 5, 1, 50),
    maxHostConcurrency: 2,
    schedulerBatchSize: 50,
    schedulerPollMs: 5_000,
    jobRetryLimit: 2,
    jobRetryDelaySeconds: 5,
    defaultIncidentThreshold: 2,
    minIncidentThreshold: 1,
    maxIncidentThreshold: 10,
    userAgent:
      process.env.MONITOR_USER_AGENT?.trim() ||
      "LeadGuardBot/1.0 (+https://leadguard.app)",
  };
}

export const monitorCheckQueue = "monitor.check";
