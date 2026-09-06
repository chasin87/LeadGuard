import {
  enqueueBrowserMonitorCheck,
  enqueueMonitorCheck,
  enqueueGoogleConversionStatus,
  enqueueGoogleConversionSubmit,
} from "@/jobs/queue";
import { DomainError } from "@/server/authorization/errors";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { retryConversionExportRecord } from "@/server/google-ads/conversion-config";
import { database } from "@/server/database";
import type { PlatformActor } from "@/server/platform-admin/access";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import { boundReason } from "@/server/platform-admin/constants";
import { assertPlatformActor } from "@/server/platform-admin/guard";
import { monitorCheckQueue } from "@/server/monitoring/config";
import { browserCheckQueue } from "@/server/monitoring/browser/config";
import {
  googleConversionStatusQueue,
  googleConversionSubmitQueue,
} from "@/server/google-data-manager/config";

export async function runMonitorNow(input: {
  monitorId: string;
  actor: PlatformActor;
  reason: string;
}) {
  assertPlatformActor(input.actor, "platform:monitoring:manage");
  const reason = boundReason(input.reason) || "platform run now";
  const limit = consumeRateLimit(
    `platform-monitor-run:${input.actor.userId}`,
    10,
    60_000,
  );
  if (!limit.ok) {
    throw new DomainError("Wait before running another monitor check.");
  }
  const monitor = await database.monitor.findFirst({
    where: { id: input.monitorId, deletedAt: null },
    include: {
      website: {
        select: {
          id: true,
          hostname: true,
          organizationId: true,
          status: true,
        },
      },
    },
  });
  if (!monitor) throw new DomainError("Monitor was not found.");
  if (monitor.website.status !== "ACTIVE") {
    throw new DomainError("The website is disabled.");
  }
  if (monitor.type === "FORM") {
    throw new DomainError("Form monitors cannot use Run now.");
  }
  if (monitor.status !== "ACTIVE") {
    throw new DomainError("Resume the monitor before running a check.");
  }
  const enqueue =
    monitor.type === "BROWSER"
      ? enqueueBrowserMonitorCheck
      : enqueueMonitorCheck;
  const jobId = await enqueue({
    monitorId: monitor.id,
    hostname: monitor.website.hostname,
    organizationId: monitor.website.organizationId,
    websiteId: monitor.website.id,
    source: "manual",
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "MONITOR_RUN_TRIGGERED",
    targetType: "Monitor",
    targetId: monitor.id,
    organizationId: monitor.website.organizationId,
    reason,
    metadata: { queued: Boolean(jobId), type: monitor.type },
  });
  return {
    queued: Boolean(jobId),
    message: jobId
      ? "Check queued."
      : "A check is already queued or running for this monitor.",
  };
}

export async function retrySafeJob(input: {
  jobName: string;
  entityId: string;
  actor: PlatformActor;
  reason: string;
}) {
  assertPlatformActor(input.actor, "platform:operations:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  const limit = consumeRateLimit(
    `platform-job-retry:${input.actor.userId}`,
    8,
    60_000,
  );
  if (!limit.ok) {
    throw new DomainError("Wait before retrying another job.");
  }
  if (
    input.jobName === monitorCheckQueue ||
    input.jobName === browserCheckQueue
  ) {
    return runMonitorNow({
      monitorId: input.entityId,
      actor: input.actor,
      reason,
    });
  }
  if (
    input.jobName === googleConversionSubmitQueue ||
    input.jobName === googleConversionStatusQueue
  ) {
    const row = await retryConversionExportRecord(input.entityId);
    if (row.dataManagerRequestId) {
      await enqueueGoogleConversionStatus(row.id);
    } else {
      await enqueueGoogleConversionSubmit(row.id);
    }
    await recordPlatformAudit({
      actor: input.actor,
      action: "JOB_RETRY_TRIGGERED",
      targetType: "GoogleAdsConversionExport",
      targetId: row.id,
      organizationId: row.organizationId,
      reason,
      metadata: { jobName: input.jobName, status: row.status },
    });
    return { queued: true, message: "Conversion retry queued." };
  }
  throw new DomainError("This job type cannot be retried from platform admin.");
}

export async function listFailedJobs() {
  try {
    const rows = await database.$queryRaw<
      Array<{
        id: string;
        name: string;
        state: string;
        retrycount: number;
        createdon: Date;
        startedon: Date | null;
        completedon: Date | null;
        output: unknown;
      }>
    >`
      SELECT
        id::text AS id,
        name,
        state,
        retry_count AS retrycount,
        created_on AS createdon,
        started_on AS startedon,
        completed_on AS completedon,
        output
      FROM pgboss.job
      WHERE state = 'failed'
      ORDER BY created_on DESC
      LIMIT 50
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      attempts: row.retrycount,
      createdAt: row.createdon,
      lastAttemptAt: row.startedon ?? row.completedon,
      errorCode: safeErrorCode(row.output),
    }));
  } catch {
    return [];
  }
}

export async function listQueueSummaries() {
  try {
    const rows = await database.$queryRaw<
      Array<{
        name: string;
        state: string;
        count: bigint;
        oldest: Date | null;
      }>
    >`
      SELECT
        name,
        state,
        COUNT(*)::bigint AS count,
        MIN(created_on) AS oldest
      FROM pgboss.job
      WHERE state IN ('created', 'active', 'failed')
      GROUP BY name, state
    `;
    const byName = new Map<
      string,
      {
        name: string;
        pending: number;
        running: number;
        failed: number;
        oldestPendingAgeMs: number | null;
      }
    >();
    const now = Date.now();
    for (const row of rows) {
      const current = byName.get(row.name) ?? {
        name: row.name,
        pending: 0,
        running: 0,
        failed: 0,
        oldestPendingAgeMs: null,
      };
      const count = Number(row.count);
      if (row.state === "created") {
        current.pending = count;
        current.oldestPendingAgeMs = row.oldest
          ? now - row.oldest.getTime()
          : null;
      } else if (row.state === "active") {
        current.running = count;
      } else if (row.state === "failed") {
        current.failed = count;
      }
      byName.set(row.name, current);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function safeErrorCode(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const message = record.message ?? record.code ?? record.error;
  if (typeof message === "string") return message.slice(0, 80);
  return null;
}
