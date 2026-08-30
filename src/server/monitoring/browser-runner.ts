import { Pool, type PoolClient } from "pg";
import { getServerEnvironment } from "@/lib/env";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import { performBrowserMonitorCheck } from "@/server/monitoring/browser/check";
import { storeCheckScreenshot } from "@/server/monitoring/browser/artifacts";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import { isBrowserInfrastructureError } from "@/server/monitoring/browser/errors";
import { restartBrowser } from "@/server/monitoring/browser/session";
import type { DnsResolver } from "@/server/security/ssrf";

const logger = createLogger("browser-worker");
const browserLockClass = 904_202;

let lockPool: Pool | undefined;

function getLockPool(): Pool {
  lockPool ??= new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 4,
    application_name: "leadguard-browser-lock",
  });
  return lockPool;
}

export async function disconnectBrowserLocks(): Promise<void> {
  if (!lockPool) return;
  await lockPool.end();
  lockPool = undefined;
}

export type ExecuteBrowserJobOptions = {
  jobId?: string;
  resolver?: DnsResolver;
  allowPrivateLoopbackForTests?: boolean;
  signal?: AbortSignal;
};

async function tryLockMonitor(
  client: PoolClient,
  monitorId: string,
): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked",
    [monitorId, browserLockClass],
  );
  return result.rows[0]?.locked === true;
}

async function unlockMonitor(
  client: PoolClient,
  monitorId: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1), $2)", [
    monitorId,
    browserLockClass,
  ]);
}

export async function executeBrowserMonitorJob(
  monitorId: string,
  options: ExecuteBrowserJobOptions = {},
): Promise<"skipped" | "completed"> {
  const client = await getLockPool().connect();
  let locked = false;
  try {
    locked = await tryLockMonitor(client, monitorId);
    if (!locked) {
      logger.info("browser.check.locked", { monitorId });
      throw new Error("Monitor is already being checked.");
    }

    const monitor = await database.monitor.findFirst({
      where: { id: monitorId, deletedAt: null, type: "BROWSER" },
      include: {
        website: {
          select: {
            id: true,
            organizationId: true,
            status: true,
            hostname: true,
          },
        },
        browserConfig: true,
      },
    });

    if (
      !monitor ||
      monitor.status !== "ACTIVE" ||
      monitor.website.status !== "ACTIVE"
    ) {
      logger.info("browser.check.skipped_inactive", {
        monitorId,
        organizationId: monitor?.website.organizationId,
        websiteId: monitor?.websiteId,
      });
      return "skipped";
    }

    const viewport = monitor.browserConfig?.viewport ?? "DESKTOP";
    const context = {
      jobId: options.jobId ?? null,
      monitorId: monitor.id,
      websiteId: monitor.websiteId,
      organizationId: monitor.website.organizationId,
    };
    logger.info("browser.check.started", context);

    const startedAt = new Date();
    const result = await performBrowserMonitorCheck(monitor.normalizedUrl, {
      timeoutMs: monitor.timeoutMs,
      viewport,
      requiredSelector: monitor.browserConfig?.requiredSelector,
      requiredElementName: monitor.browserConfig?.requiredElementName,
      resolver: options.resolver,
      allowPrivateLoopbackForTests: options.allowPrivateLoopbackForTests,
      signal: options.signal,
    });
    const finishedAt = new Date();

    logger.info("browser.navigation.completed", {
      ...context,
      httpStatus: result.httpStatus,
      durationMs: result.browserDetail.navigationDurationMs,
    });

    const screenshotBuffer = result.browserDetail.screenshotBuffer;
    const persistable = {
      ...result,
      browserDetail: {
        ...result.browserDetail,
        screenshotBuffer: null,
      },
    };

    const { checkId, outcome } = await persistAndProcessCheck({
      monitorId: monitor.id,
      organizationId: monitor.website.organizationId,
      websiteId: monitor.websiteId,
      jobId: options.jobId,
      startedAt,
      finishedAt,
      result: persistable,
    });

    if (screenshotBuffer && screenshotBuffer.byteLength > 0) {
      await storeCheckScreenshot({
        organizationId: monitor.website.organizationId,
        checkId,
        body: screenshotBuffer,
      });
    }

    logger.info("browser.check.completed", {
      ...context,
      checkId,
      status: result.status,
      httpStatus: result.httpStatus,
      errorType: result.errorType,
      incidentTransition:
        outcome.kind === "opened"
          ? "NONE → OPEN"
          : outcome.kind === "resolved"
            ? "OPEN → RESOLVED"
            : outcome.kind === "updated"
              ? "OPEN → OPEN"
              : "NONE",
    });
    return "completed";
  } catch (error) {
    if (isBrowserInfrastructureError(error)) {
      logger.error("browser.check.failed_execution", {
        monitorId,
        jobId: options.jobId ?? null,
        infrastructure: true,
        message: error.message,
      });
      await restartBrowser("infrastructure").catch(() => undefined);
      throw error;
    }
    logger.error("browser.check.failed_execution", {
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

export function getBrowserWorkerConcurrency(): number {
  return getBrowserMonitoringConfig().workerConcurrency;
}
