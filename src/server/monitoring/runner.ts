import { Pool, type PoolClient } from "pg";
import type { MonitorCheckErrorType } from "@/generated/prisma/enums";
import { getServerEnvironment } from "@/lib/env";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import { getMonitoringConfig } from "@/server/monitoring/config";
import { withHostConcurrency } from "@/server/monitoring/host-concurrency";
import {
  performHttpMonitorCheck,
  type PerformHttpCheckOptions,
} from "@/server/monitoring/http-check";

const logger = createLogger("monitor-worker");
const monitorLockClass = 904_201;

let lockPool: Pool | undefined;

function getLockPool(): Pool {
  lockPool ??= new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 8,
    application_name: "leadguard-monitor-lock",
  });
  return lockPool;
}

export async function disconnectMonitorLocks(): Promise<void> {
  if (!lockPool) return;
  await lockPool.end();
  lockPool = undefined;
}

export type ExecuteMonitorJobOptions = PerformHttpCheckOptions & {
  jobId?: string;
};

async function tryLockMonitor(
  client: PoolClient,
  monitorId: string,
): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked",
    [monitorId, monitorLockClass],
  );
  return result.rows[0]?.locked === true;
}

async function unlockMonitor(
  client: PoolClient,
  monitorId: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1), $2)", [
    monitorId,
    monitorLockClass,
  ]);
}

export async function executeMonitorJob(
  monitorId: string,
  options: ExecuteMonitorJobOptions = {},
): Promise<"skipped" | "completed"> {
  const client = await getLockPool().connect();
  let locked = false;
  try {
    locked = await tryLockMonitor(client, monitorId);
    if (!locked) {
      logger.info("monitor.check.locked", { monitorId });
      throw new Error("Monitor is already being checked.");
    }

    const monitor = await database.monitor.findFirst({
      where: { id: monitorId, deletedAt: null },
      include: {
        website: {
          select: {
            id: true,
            organizationId: true,
            status: true,
            hostname: true,
          },
        },
      },
    });

    if (
      !monitor ||
      (monitor.type !== "HTTP" && monitor.type !== "AD_DESTINATION") ||
      monitor.status !== "ACTIVE" ||
      monitor.website.status !== "ACTIVE"
    ) {
      logger.info("monitor.check.skipped_inactive", {
        monitorId,
        organizationId: monitor?.website.organizationId,
        websiteId: monitor?.websiteId,
      });
      return "skipped";
    }

    const context = {
      jobId: options.jobId ?? null,
      monitorId: monitor.id,
      websiteId: monitor.websiteId,
      organizationId: monitor.website.organizationId,
    };
    logger.info("monitor.check.started", context);

    const config = getMonitoringConfig();
    const startedAt = new Date();
    const result = await withHostConcurrency(
      monitor.website.hostname,
      config.maxHostConcurrency,
      () =>
        performHttpMonitorCheck(monitor.normalizedUrl, {
          ...options,
          timeoutMs: monitor.timeoutMs,
        }),
    );
    const finishedAt = new Date();

    const { checkId, outcome } = await persistAndProcessCheck({
      monitorId: monitor.id,
      organizationId: monitor.website.organizationId,
      websiteId: monitor.websiteId,
      jobId: options.jobId,
      startedAt,
      finishedAt,
      result,
    });

    logger.info("monitor.check.completed", {
      ...context,
      checkId,
      status: result.status,
      httpStatus: result.httpStatus,
      errorType: result.errorType,
      soft404Score: result.soft404Score ?? null,
      incidentTransition:
        outcome.kind === "opened"
          ? "NONE → OPEN"
          : outcome.kind === "resolved"
            ? "OPEN → RESOLVED"
            : outcome.kind === "updated"
              ? "OPEN → OPEN"
              : "NONE",
    });
    if (result.errorType === "SOFT_404") {
      logger.info("soft404.detected", {
        ...context,
        checkId,
        score: result.soft404Score ?? 0,
        classifierVersion: result.soft404ClassifierVersion ?? "v1",
      });
    }
    return "completed";
  } catch (error) {
    logger.error("monitor.check.failed_execution", {
      monitorId,
      jobId: options.jobId ?? null,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  } finally {
    try {
      if (locked) await unlockMonitor(client, monitorId);
    } finally {
      client.release();
    }
  }
}

export function userFacingCheckError(
  errorType: MonitorCheckErrorType | null,
  fallback: string | null,
): string | null {
  if (!errorType) return fallback;
  switch (errorType) {
    case "HTTP_404":
      return "HTTP 404";
    case "HTTP_401":
      return "HTTP 401";
    case "HTTP_403":
      return "HTTP 403";
    case "HTTP_429":
      return "HTTP 429";
    case "HTTP_4XX":
      return "HTTP client error";
    case "HTTP_5XX":
      return "HTTP server error";
    case "SOFT_404":
      return "Soft 404";
    case "TIMEOUT":
      return "Timeout";
    case "DNS_ERROR":
      return "DNS error";
    case "SSL_ERROR":
      return "SSL certificate error";
    case "CONNECTION_ERROR":
      return "Connection failed";
    case "REDIRECT_LOOP":
      return "Redirect loop";
    case "TOO_MANY_REDIRECTS":
      return "Too many redirects";
    case "UNSAFE_REDIRECT":
      return "Unsafe redirect";
    case "UNSAFE_TARGET":
      return "Unsafe target";
    case "INVALID_RESPONSE":
      return "Invalid response";
    case "BROWSER_NAVIGATION_ERROR":
      return "Browser could not open the page";
    case "BROWSER_TIMEOUT":
      return "Browser timed out";
    case "BROWSER_CRASH":
      return "Browser crashed";
    case "PAGE_CRASH":
      return "Page crashed";
    case "JAVASCRIPT_ERROR":
      return "JavaScript error";
    case "REQUIRED_ELEMENT_MISSING":
      return "Required element missing";
    case "CONTENT_NOT_RENDERED":
      return "Page did not render";
    case "UNSAFE_BROWSER_REQUEST":
      return "Unsafe browser request";
    case "TOO_MANY_BROWSER_ERRORS":
      return "Too many browser errors";
    case "INVALID_MONITOR_CONFIGURATION":
      return "Monitor configuration is invalid";
    default:
      return fallback ?? "Check failed";
  }
}
