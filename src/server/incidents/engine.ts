import { Prisma } from "@/generated/prisma/client";
import type {
  BrowserViewport,
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import type { HttpCheckResult } from "@/server/monitoring/http-check";
import { insertIncidentOutboxEvent } from "@/server/notifications/outbox";
import type { BrowserCheckDetailInput } from "@/server/monitoring/browser/check";
import type { FormCheckDetailInput } from "@/server/monitoring/form/types";
import { isNonIncidentMonitorError } from "@/server/monitoring/form/classify";
import { scheduleGoogleAdsIncidentImpact } from "@/server/google-ads/impact/refresh";

const logger = createLogger("incidents");

type Transaction = Prisma.TransactionClient;

export type IncidentOutcome =
  | { kind: "none" }
  | {
      kind: "skipped";
      reason: "already_processed" | "out_of_order";
    }
  | { kind: "opened"; incidentId: string }
  | { kind: "updated"; incidentId: string }
  | { kind: "resolved"; incidentId: string };

export type PersistCheckInput = {
  monitorId: string;
  organizationId: string;
  websiteId: string;
  jobId?: string | null;
  startedAt: Date;
  finishedAt: Date;
  deferIncident?: boolean;
  result: HttpCheckResult & {
    browserDetail?: Omit<BrowserCheckDetailInput, "screenshotBuffer"> & {
      screenshotBuffer?: Buffer | null;
      viewport: BrowserViewport;
    };
    formDetail?: Omit<FormCheckDetailInput, "screenshotBuffer"> & {
      screenshotBuffer?: Buffer | null;
    };
  };
};

function nextConsecutiveFailures(
  status: MonitorCheckStatus,
  current: number,
  errorType: MonitorCheckErrorType | null,
): number {
  if (isNonIncidentMonitorError(errorType)) return current;
  if (status === "FAILURE") return current + 1;
  return 0;
}

function isRecoveringStatus(status: MonitorCheckStatus): boolean {
  return status === "SUCCESS" || status === "DEGRADED";
}

function logTransition(
  message: string,
  context: {
    organizationId: string;
    websiteId: string;
    monitorId: string;
    incidentId?: string;
    checkId: string;
    from?: string;
    to?: string;
  },
) {
  logger.info(message, context);
}

async function findFailureStreak(
  tx: Transaction,
  monitorId: string,
  detectingCheck: {
    id: string;
    startedAt: Date;
    finishedAt: Date;
    errorType: MonitorCheckErrorType | null;
    httpStatus: number | null;
  },
  take: number,
) {
  const recent = await tx.monitorCheck.findMany({
    where: {
      monitorId,
      finishedAt: { lte: detectingCheck.finishedAt },
    },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: Math.max(take, 1) + 1,
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      errorType: true,
      httpStatus: true,
    },
  });

  const streak: typeof recent = [];
  for (const row of recent) {
    if (row.status !== "FAILURE") break;
    streak.push(row);
  }
  if (streak.length === 0) {
    return [detectingCheck];
  }
  return streak;
}

async function openIncident(
  tx: Transaction,
  input: {
    monitorId: string;
    organizationId: string;
    websiteId: string;
    checkId: string;
    consecutiveFailures: number;
    detecting: {
      id: string;
      startedAt: Date;
      finishedAt: Date;
      errorType: MonitorCheckErrorType | null;
      httpStatus: number | null;
    };
  },
): Promise<IncidentOutcome> {
  const streak = await findFailureStreak(
    tx,
    input.monitorId,
    input.detecting,
    input.consecutiveFailures,
  );
  const first = streak[streak.length - 1] ?? input.detecting;

  try {
    const created = await tx.incident.create({
      data: {
        monitorId: input.monitorId,
        status: "OPEN",
        startedAt: first.startedAt,
        detectedAt: input.detecting.finishedAt,
        initialErrorType: first.errorType,
        latestErrorType: input.detecting.errorType,
        initialHttpStatus: first.httpStatus,
        latestHttpStatus: input.detecting.httpStatus,
        firstFailedCheckId: first.id,
        lastFailedCheckId: input.detecting.id,
        failureCount: input.consecutiveFailures,
      },
      select: {
        id: true,
        startedAt: true,
        detectedAt: true,
        initialErrorType: true,
        initialHttpStatus: true,
      },
    });
    await insertIncidentOutboxEvent(tx, {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitorId: input.monitorId,
      incidentId: created.id,
      eventType: "INCIDENT_OPENED",
      startedAt: created.startedAt,
      detectedAt: created.detectedAt,
      resolvedAt: null,
      errorType: created.initialErrorType,
      httpStatus: created.initialHttpStatus,
      recoveryHttpStatus: null,
    });
    logTransition("incident.opened", {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitorId: input.monitorId,
      incidentId: created.id,
      checkId: input.checkId,
      from: "NONE",
      to: "OPEN",
    });
    return { kind: "opened", incidentId: created.id };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await tx.incident.findFirst({
        where: { monitorId: input.monitorId, status: "OPEN" },
        select: { id: true, failureCount: true },
      });
      if (existing) {
        return updateOpenIncident(tx, {
          incidentId: existing.id,
          organizationId: input.organizationId,
          websiteId: input.websiteId,
          monitorId: input.monitorId,
          checkId: input.checkId,
          errorType: input.detecting.errorType,
          httpStatus: input.detecting.httpStatus,
          previousFailureCount: existing.failureCount,
        });
      }
    }
    throw error;
  }
}

async function updateOpenIncident(
  tx: Transaction,
  input: {
    incidentId: string;
    organizationId: string;
    websiteId: string;
    monitorId: string;
    checkId: string;
    errorType: MonitorCheckErrorType | null;
    httpStatus: number | null;
    previousFailureCount: number;
  },
): Promise<IncidentOutcome> {
  await tx.incident.update({
    where: { id: input.incidentId },
    data: {
      latestErrorType: input.errorType,
      latestHttpStatus: input.httpStatus,
      lastFailedCheckId: input.checkId,
      failureCount: input.previousFailureCount + 1,
    },
  });
  logTransition("incident.updated", {
    organizationId: input.organizationId,
    websiteId: input.websiteId,
    monitorId: input.monitorId,
    incidentId: input.incidentId,
    checkId: input.checkId,
    from: "OPEN",
    to: "OPEN",
  });
  return { kind: "updated", incidentId: input.incidentId };
}

async function resolveOpenIncident(
  tx: Transaction,
  input: {
    incidentId: string;
    organizationId: string;
    websiteId: string;
    monitorId: string;
    checkId: string;
    resolvedAt: Date;
    recoveryHttpStatus: number | null;
  },
): Promise<IncidentOutcome> {
  const existing = await tx.incident.findFirst({
    where: { id: input.incidentId },
    select: {
      startedAt: true,
      detectedAt: true,
      latestErrorType: true,
      latestHttpStatus: true,
    },
  });
  await tx.incident.update({
    where: { id: input.incidentId },
    data: {
      status: "RESOLVED",
      resolvedAt: input.resolvedAt,
      recoveryCheckId: input.checkId,
    },
  });
  if (existing) {
    await insertIncidentOutboxEvent(tx, {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitorId: input.monitorId,
      incidentId: input.incidentId,
      eventType: "INCIDENT_RESOLVED",
      startedAt: existing.startedAt,
      detectedAt: existing.detectedAt,
      resolvedAt: input.resolvedAt,
      errorType: existing.latestErrorType,
      httpStatus: existing.latestHttpStatus,
      recoveryHttpStatus: input.recoveryHttpStatus,
    });
  }
  logTransition("incident.resolved", {
    organizationId: input.organizationId,
    websiteId: input.websiteId,
    monitorId: input.monitorId,
    incidentId: input.incidentId,
    checkId: input.checkId,
    from: "OPEN",
    to: "RESOLVED",
  });
  return { kind: "resolved", incidentId: input.incidentId };
}

async function applyIncidentState(
  tx: Transaction,
  input: {
    organizationId: string;
    websiteId: string;
    monitor: {
      id: string;
      consecutiveFailures: number;
      consecutiveFailuresBeforeIncident: number;
      lastCheckedAt: Date | null;
    };
    check: {
      id: string;
      status: MonitorCheckStatus;
      startedAt: Date;
      finishedAt: Date;
      errorType: MonitorCheckErrorType | null;
      httpStatus: number | null;
    };
  },
): Promise<IncidentOutcome> {
  if (
    input.monitor.lastCheckedAt &&
    input.check.finishedAt < input.monitor.lastCheckedAt
  ) {
    logger.info("incident.processing.skipped", {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitorId: input.monitor.id,
      checkId: input.check.id,
      reason: "out_of_order",
    });
    return { kind: "skipped", reason: "out_of_order" };
  }

  const consecutiveFailures = nextConsecutiveFailures(
    input.check.status,
    input.monitor.consecutiveFailures,
    input.check.errorType,
  );
  await tx.monitor.update({
    where: { id: input.monitor.id },
    data: {
      consecutiveFailures,
      lastCheckedAt: input.check.finishedAt,
    },
  });

  if (isNonIncidentMonitorError(input.check.errorType)) {
    return { kind: "none" };
  }

  const open = await tx.incident.findFirst({
    where: { monitorId: input.monitor.id, status: "OPEN" },
    select: { id: true, failureCount: true },
  });

  if (input.check.status === "FAILURE") {
    if (open) {
      return updateOpenIncident(tx, {
        incidentId: open.id,
        organizationId: input.organizationId,
        websiteId: input.websiteId,
        monitorId: input.monitor.id,
        checkId: input.check.id,
        errorType: input.check.errorType,
        httpStatus: input.check.httpStatus,
        previousFailureCount: open.failureCount,
      });
    }
    if (
      consecutiveFailures >= input.monitor.consecutiveFailuresBeforeIncident
    ) {
      return openIncident(tx, {
        monitorId: input.monitor.id,
        organizationId: input.organizationId,
        websiteId: input.websiteId,
        checkId: input.check.id,
        consecutiveFailures,
        detecting: input.check,
      });
    }
    return { kind: "none" };
  }

  if (open && isRecoveringStatus(input.check.status)) {
    return resolveOpenIncident(tx, {
      incidentId: open.id,
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitorId: input.monitor.id,
      checkId: input.check.id,
      resolvedAt: input.check.finishedAt,
      recoveryHttpStatus: input.check.httpStatus,
    });
  }

  return { kind: "none" };
}

export async function persistAndProcessCheck(
  input: PersistCheckInput,
): Promise<{ checkId: string; outcome: IncidentOutcome }> {
  const result = await database.$transaction(
    async (
      tx,
    ): Promise<{
      checkId: string;
      outcome: IncidentOutcome;
    }> => {
      await tx.$queryRaw`
      SELECT id FROM "Monitor" WHERE id = ${input.monitorId} FOR UPDATE
    `;
      const monitor = await tx.monitor.findFirst({
        where: { id: input.monitorId },
        select: {
          id: true,
          consecutiveFailures: true,
          consecutiveFailuresBeforeIncident: true,
          lastCheckedAt: true,
        },
      });
      if (!monitor) {
        throw new Error(
          "Monitor disappeared before the check could be stored.",
        );
      }

      const check = await tx.monitorCheck.create({
        data: {
          monitorId: monitor.id,
          jobId: input.jobId,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          status: input.result.status,
          httpStatus: input.result.httpStatus,
          responseTimeMs: input.result.responseTimeMs,
          requestedUrl: input.result.requestedUrl,
          finalUrl: input.result.finalUrl,
          redirectCount: input.result.redirectCount,
          resolvedIp: input.result.resolvedIp,
          errorType: input.result.errorType,
          errorMessage: input.result.errorMessage,
          soft404Score: input.result.soft404Score ?? null,
          soft404ClassifierVersion:
            input.result.soft404ClassifierVersion ?? null,
          soft404Signals: input.result.soft404Signals ?? undefined,
          browserDetail: input.result.browserDetail
            ? {
                create: {
                  viewport: input.result.browserDetail.viewport,
                  navigationDurationMs:
                    input.result.browserDetail.navigationDurationMs,
                  totalDurationMs: input.result.browserDetail.totalDurationMs,
                  javascriptErrorCount:
                    input.result.browserDetail.javascriptErrorCount,
                  pageErrorCount: input.result.browserDetail.pageErrorCount,
                  failedResourceCount:
                    input.result.browserDetail.failedResourceCount,
                  requiredElementFound:
                    input.result.browserDetail.requiredElementFound,
                  renderedTextLength:
                    input.result.browserDetail.renderedTextLength,
                  javascriptErrors: input.result.browserDetail.javascriptErrors,
                  failedResources: input.result.browserDetail.failedResources,
                  dialogOccurred: input.result.browserDetail.dialogOccurred,
                },
              }
            : undefined,
          formDetail: input.result.formDetail
            ? {
                create: {
                  submissionId: input.result.formDetail.submissionId,
                  submissionState: input.result.formDetail.submissionState,
                  successConfirmed: input.result.formDetail.successConfirmed,
                  submissionDurationMs:
                    input.result.formDetail.submissionDurationMs,
                  submitHttpStatus: input.result.formDetail.submitHttpStatus,
                  submitEndpointPath:
                    input.result.formDetail.submitEndpointPath,
                  submitMethod: input.result.formDetail.submitMethod,
                  fieldsExpectedCount:
                    input.result.formDetail.fieldsExpectedCount,
                  fieldsFoundCount: input.result.formDetail.fieldsFoundCount,
                  formFound: input.result.formDetail.formFound,
                  submitClicked: input.result.formDetail.submitClicked,
                  captchaDetected: input.result.formDetail.captchaDetected,
                  validationErrors:
                    input.result.formDetail.validationErrors ?? undefined,
                  unmappedRequiredFields:
                    input.result.formDetail.unmappedRequiredFields ?? undefined,
                },
              }
            : undefined,
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          errorType: true,
          httpStatus: true,
          incidentProcessedAt: true,
        },
      });

      const claimed = await tx.monitorCheck.updateMany({
        where: { id: check.id, incidentProcessedAt: null },
        data: { incidentProcessedAt: new Date() },
      });
      if (claimed.count !== 1) {
        logger.info("incident.processing.skipped", {
          organizationId: input.organizationId,
          websiteId: input.websiteId,
          monitorId: monitor.id,
          checkId: check.id,
          reason: "already_processed",
        });
        return {
          checkId: check.id,
          outcome: { kind: "skipped", reason: "already_processed" },
        };
      }

      if (input.deferIncident) {
        await tx.monitor.update({
          where: { id: monitor.id },
          data: { lastCheckedAt: check.finishedAt },
        });
        return { checkId: check.id, outcome: { kind: "none" } };
      }

      const outcome = await applyIncidentState(tx, {
        organizationId: input.organizationId,
        websiteId: input.websiteId,
        monitor,
        check,
      });
      return { checkId: check.id, outcome };
    },
  );
  await scheduleGoogleAdsIncidentImpact(input.monitorId, result.outcome);
  return result;
}

export async function reprocessMonitorCheck(input: {
  checkId: string;
  organizationId: string;
  websiteId: string;
}): Promise<IncidentOutcome> {
  let monitorId = "";
  const outcome = await database.$transaction(async (tx) => {
    const check = await tx.monitorCheck.findFirst({
      where: { id: input.checkId },
      select: {
        id: true,
        monitorId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        errorType: true,
        httpStatus: true,
        incidentProcessedAt: true,
      },
    });
    if (!check) {
      return { kind: "skipped" as const, reason: "already_processed" as const };
    }
    monitorId = check.monitorId;

    await tx.$queryRaw`
      SELECT id FROM "Monitor" WHERE id = ${check.monitorId} FOR UPDATE
    `;

    const claimed = await tx.monitorCheck.updateMany({
      where: { id: check.id, incidentProcessedAt: null },
      data: { incidentProcessedAt: new Date() },
    });
    if (claimed.count !== 1) {
      logger.info("incident.processing.skipped", {
        organizationId: input.organizationId,
        websiteId: input.websiteId,
        monitorId: check.monitorId,
        checkId: check.id,
        reason: "already_processed",
      });
      return { kind: "skipped" as const, reason: "already_processed" as const };
    }

    const monitor = await tx.monitor.findFirst({
      where: { id: check.monitorId },
      select: {
        id: true,
        consecutiveFailures: true,
        consecutiveFailuresBeforeIncident: true,
        lastCheckedAt: true,
      },
    });
    if (!monitor) {
      return { kind: "skipped" as const, reason: "already_processed" as const };
    }

    return applyIncidentState(tx, {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitor,
      check,
    });
  });
  if (monitorId) {
    await scheduleGoogleAdsIncidentImpact(monitorId, outcome);
  }
  return outcome;
}

export async function applyReceiptRecovery(input: {
  monitorId: string;
  organizationId: string;
  websiteId: string;
  recoveryCheckId: string;
  recoveredAt: Date;
}): Promise<IncidentOutcome> {
  const outcome = await database.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Monitor" WHERE id = ${input.monitorId} FOR UPDATE
    `;
    const monitor = await tx.monitor.findFirst({
      where: { id: input.monitorId },
      select: { id: true, consecutiveFailures: true },
    });
    if (!monitor) {
      return { kind: "skipped" as const, reason: "already_processed" as const };
    }
    await tx.monitor.update({
      where: { id: monitor.id },
      data: { consecutiveFailures: 0, lastCheckedAt: input.recoveredAt },
    });
    const open = await tx.incident.findFirst({
      where: { monitorId: monitor.id, status: "OPEN" },
      select: { id: true },
    });
    if (!open) return { kind: "none" as const };
    const check = await tx.monitorCheck.findFirst({
      where: { id: input.recoveryCheckId },
      select: { httpStatus: true },
    });
    return resolveOpenIncident(tx, {
      incidentId: open.id,
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      monitorId: monitor.id,
      checkId: input.recoveryCheckId,
      resolvedAt: input.recoveredAt,
      recoveryHttpStatus: check?.httpStatus ?? 200,
    });
  });
  await scheduleGoogleAdsIncidentImpact(input.monitorId, outcome);
  return outcome;
}
