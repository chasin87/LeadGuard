import { Pool, type PoolClient } from "pg";
import { Prisma } from "@/generated/prisma/client";
import { getServerEnvironment } from "@/lib/env";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import { storeCheckScreenshot } from "@/server/monitoring/browser/artifacts";
import { isBrowserInfrastructureError } from "@/server/monitoring/browser/errors";
import { restartBrowser } from "@/server/monitoring/browser/session";
import { withHostConcurrency } from "@/server/monitoring/host-concurrency";
import {
  completeFormSubmissionAttempt,
  markFormSubmissionSubmitting,
  prepareFormSubmissionAttempt,
} from "@/server/monitoring/form/attempt";
import {
  performFormConfigurationValidation,
  performFormMonitorCheck,
} from "@/server/monitoring/form/check";
import { getFormMonitoringConfig } from "@/server/monitoring/form/config";
import { parseFieldMappings } from "@/server/monitoring/form/mappings";
import { resolveFormTestValues } from "@/server/monitoring/form/test-data";
import type { FormMonitorRuntimeConfig } from "@/server/monitoring/form/types";
import type { DnsResolver } from "@/server/security/ssrf";
import { inboundReceiptAddress } from "@/server/receipts/config";
import {
  createLeadReceiptVerification,
  monitorHasPendingReceipt,
  receiptMethodForMode,
} from "@/server/receipts/service";

const logger = createLogger("form-worker");
const formLockClass = 904_203;

let lockPool: Pool | undefined;

function getLockPool(): Pool {
  lockPool ??= new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 4,
    application_name: "leadguard-form-lock",
  });
  return lockPool;
}

export async function disconnectFormLocks(): Promise<void> {
  if (!lockPool) return;
  await lockPool.end();
  lockPool = undefined;
}

export type FormJobMode = "submit" | "validate";

export type ExecuteFormJobOptions = {
  jobId?: string;
  mode?: FormJobMode;
  source?: "scheduler" | "manual";
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
    [monitorId, formLockClass],
  );
  return result.rows[0]?.locked === true;
}

async function unlockMonitor(
  client: PoolClient,
  monitorId: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1), $2)", [
    monitorId,
    formLockClass,
  ]);
}

export async function executeFormMonitorJob(
  monitorId: string,
  options: ExecuteFormJobOptions = {},
): Promise<"skipped" | "completed"> {
  const client = await getLockPool().connect();
  let locked = false;
  try {
    locked = await tryLockMonitor(client, monitorId);
    if (!locked) {
      logger.info("form.check.locked", { monitorId });
      throw new Error("Monitor is already being checked.");
    }

    const monitor = await database.monitor.findFirst({
      where: { id: monitorId, deletedAt: null, type: "FORM" },
      include: {
        website: {
          select: {
            id: true,
            organizationId: true,
            status: true,
            hostname: true,
          },
        },
        formConfig: { include: { testProfile: true } },
      },
    });

    if (
      !monitor ||
      !monitor.formConfig ||
      monitor.website.status !== "ACTIVE"
    ) {
      logger.info("form.check.skipped_inactive", { monitorId });
      return "skipped";
    }
    const formConfig = monitor.formConfig;

    const mode = options.mode ?? "submit";
    const source = options.source ?? "scheduler";
    if (source === "scheduler" && monitor.status !== "ACTIVE") {
      logger.info("form.check.skipped_inactive", { monitorId });
      return "skipped";
    }
    if (
      source === "scheduler" &&
      (monitor.formConfig.configurationStatus !== "VERIFIED" ||
        !monitor.formConfig.consentedAt ||
        (monitor.formConfig.receiptMode !== "NONE" &&
          !monitor.formConfig.receiptVerifiedAt))
    ) {
      logger.info("form.check.skipped_unverified", { monitorId });
      return "skipped";
    }
    if (mode === "submit" && (await monitorHasPendingReceipt(monitor.id))) {
      logger.info("form.check.skipped_pending_receipt", { monitorId });
      return "skipped";
    }

    const mappings = parseFieldMappings(monitor.formConfig.fieldMappings);
    if (!mappings.ok) {
      if (mode === "validate") {
        await saveValidation(monitor.formConfig.id, {
          ok: false,
          formFound: false,
          submitFound: false,
          submitVisible: false,
          submitEnabled: false,
          successConfigured: false,
          captchaDetected: false,
          passwordDetected: false,
          paymentDetected: false,
          fileInputDetected: false,
          fields: [],
          unmappedRequired: [],
          discovered: { forms: 0, inputs: 0, buttons: 0 },
          issues: [{ code: "mapping", message: mappings.message }],
          validatedAt: new Date().toISOString(),
        });
        return "completed";
      }
      return persistConfigurationFailure(
        { ...monitor, formConfig },
        options,
        mappings.message,
      );
    }

    const runtime: FormMonitorRuntimeConfig = {
      viewport: monitor.formConfig.viewport,
      formSelector: monitor.formConfig.formSelector,
      submitSelector: monitor.formConfig.submitSelector,
      cookieAcceptSelector: monitor.formConfig.cookieAcceptSelector,
      fieldMappings: mappings.value,
      successMode: monitor.formConfig.successMode,
      successSelector: monitor.formConfig.successSelector,
      successUrlPattern: monitor.formConfig.successUrlPattern,
      successText: monitor.formConfig.successText,
      submissionTimeoutMs: monitor.formConfig.submissionTimeoutMs,
    };

    const context = {
      jobId: options.jobId ?? null,
      monitorId: monitor.id,
      websiteId: monitor.websiteId,
      organizationId: monitor.website.organizationId,
    };

    if (mode === "validate") {
      logger.info("form.configuration.validated", {
        ...context,
        started: true,
      });
      const snapshot = await withHostConcurrency(
        monitor.website.hostname,
        1,
        () =>
          performFormConfigurationValidation(monitor.normalizedUrl, {
            timeoutMs: monitor.timeoutMs,
            config: runtime,
            mappings: mappings.value,
            resolver: options.resolver,
            allowPrivateLoopbackForTests: options.allowPrivateLoopbackForTests,
            signal: options.signal,
          }),
      );
      await saveValidation(monitor.formConfig.id, snapshot);
      logger.info("form.configuration.validated", {
        ...context,
        ok: snapshot.ok,
      });
      return "completed";
    }

    const jobId = options.jobId ?? `form-${monitor.id}-${Date.now()}`;
    const attempt = await prepareFormSubmissionAttempt({
      monitorId: monitor.id,
      jobId,
    });
    if (attempt.existingCheckId) {
      logger.info("form.check.skipped_already_persisted", {
        ...context,
        checkId: attempt.existingCheckId,
      });
      return "completed";
    }
    if (attempt.skipSubmit) {
      const existingCheck = await database.monitorCheck.findFirst({
        where: { jobId },
        select: { id: true },
      });
      if (existingCheck) {
        await completeFormSubmissionAttempt({
          attemptId: attempt.attemptId,
          checkId: existingCheck.id,
          state: "AMBIGUOUS",
        });
        return "completed";
      }
      logger.warn("form.submit.ambiguous", {
        ...context,
        submissionId: attempt.submissionId,
        reason: "retry_after_submit",
      });
      return persistAmbiguous(monitor, options, attempt);
    }

    const resolved = resolveFormTestValues({
      mappings: mappings.value,
      profile: monitor.formConfig.testProfile,
      submissionId: attempt.submissionId,
      inboundEmail:
        monitor.formConfig.receiptMode === "INBOUND_EMAIL"
          ? inboundReceiptAddress(attempt.submissionId)
          : null,
    });
    if (!resolved.ok) {
      return persistConfigurationFailure(
        { ...monitor, formConfig },
        options,
        resolved.message,
        {
          attemptId: attempt.attemptId,
          submissionId: attempt.submissionId,
        },
      );
    }

    logger.info("form.check.started", {
      ...context,
      submissionId: attempt.submissionId,
    });
    const startedAt = new Date();
    const result = await withHostConcurrency(monitor.website.hostname, 1, () =>
      performFormMonitorCheck(monitor.normalizedUrl, {
        timeoutMs: monitor.timeoutMs,
        config: runtime,
        values: resolved.values,
        mappings: mappings.value,
        submissionId: attempt.submissionId,
        resolver: options.resolver,
        allowPrivateLoopbackForTests: options.allowPrivateLoopbackForTests,
        signal: options.signal,
        onBeforeSubmit: () => markFormSubmissionSubmitting(attempt.attemptId),
      }),
    );
    const finishedAt = new Date();

    const screenshotBuffer = result.formDetail.screenshotBuffer;
    const persistable = {
      ...result,
      formDetail: {
        ...result.formDetail,
        screenshotBuffer: null,
      },
    };
    const receiptEnabled =
      monitor.formConfig.receiptMode !== "NONE" &&
      result.status === "SUCCESS" &&
      result.formDetail.successConfirmed;
    const { checkId, outcome } = await persistAndProcessCheck({
      monitorId: monitor.id,
      organizationId: monitor.website.organizationId,
      websiteId: monitor.websiteId,
      jobId,
      startedAt,
      finishedAt,
      deferIncident: receiptEnabled,
      result: persistable,
    });
    await completeFormSubmissionAttempt({
      attemptId: attempt.attemptId,
      checkId,
      state: result.formDetail.submissionState,
    });
    if (screenshotBuffer && screenshotBuffer.byteLength > 0) {
      await storeCheckScreenshot({
        organizationId: monitor.website.organizationId,
        checkId,
        body: screenshotBuffer,
      });
    }
    if (receiptEnabled) {
      const method = receiptMethodForMode(monitor.formConfig.receiptMode);
      if (method) {
        await createLeadReceiptVerification({
          organizationId: monitor.website.organizationId,
          monitorId: monitor.id,
          monitorCheckId: checkId,
          submissionAttemptId: attempt.attemptId,
          submissionId: attempt.submissionId,
          method,
          timeoutMinutes: monitor.formConfig.receiptTimeoutMinutes,
          confirmedAt: finishedAt,
        });
      }
    } else {
      await updateConfigurationAfterCheck(
        monitor.formConfig.id,
        result.errorType,
      );
    }

    logger.info("form.check.completed", {
      ...context,
      checkId,
      submissionId: attempt.submissionId,
      status: result.status,
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
      logger.error("form.check.failed_execution", {
        monitorId,
        jobId: options.jobId ?? null,
        infrastructure: true,
        message: error.message,
      });
      await restartBrowser("infrastructure").catch(() => undefined);
      throw error;
    }
    logger.error("form.check.failed_execution", {
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

async function persistConfigurationFailure(
  monitor: {
    id: string;
    websiteId: string;
    normalizedUrl: string;
    website: { organizationId: string };
    formConfig: { id: string };
  },
  options: ExecuteFormJobOptions,
  message: string,
  attempt?: { attemptId: string; submissionId: string },
): Promise<"completed"> {
  const now = new Date();
  const submissionId = attempt?.submissionId ?? "none";
  const { checkId } = await persistAndProcessCheck({
    monitorId: monitor.id,
    organizationId: monitor.website.organizationId,
    websiteId: monitor.websiteId,
    jobId: options.jobId,
    startedAt: now,
    finishedAt: now,
    result: {
      status: "FAILURE",
      httpStatus: null,
      responseTimeMs: 0,
      requestedUrl: monitor.normalizedUrl,
      finalUrl: monitor.normalizedUrl,
      redirectCount: 0,
      resolvedIp: null,
      errorType: "INVALID_MONITOR_CONFIGURATION",
      errorMessage: message,
      formDetail: {
        submissionId,
        submissionState: "FAILED",
        successConfirmed: false,
        submissionDurationMs: null,
        submitHttpStatus: null,
        submitEndpointPath: null,
        submitMethod: null,
        fieldsExpectedCount: 0,
        fieldsFoundCount: 0,
        formFound: false,
        submitClicked: false,
        captchaDetected: false,
        validationErrors: null,
        unmappedRequiredFields: null,
      },
    },
  });
  if (attempt) {
    await completeFormSubmissionAttempt({
      attemptId: attempt.attemptId,
      checkId,
      state: "FAILED",
    });
  }
  await updateConfigurationAfterCheck(
    monitor.formConfig.id,
    "INVALID_MONITOR_CONFIGURATION",
  );
  return "completed";
}

async function persistAmbiguous(
  monitor: {
    id: string;
    websiteId: string;
    normalizedUrl: string;
    website: { organizationId: string };
  },
  options: ExecuteFormJobOptions,
  attempt: { attemptId: string; submissionId: string },
): Promise<"completed"> {
  const now = new Date();
  const { checkId } = await persistAndProcessCheck({
    monitorId: monitor.id,
    organizationId: monitor.website.organizationId,
    websiteId: monitor.websiteId,
    jobId: options.jobId,
    startedAt: now,
    finishedAt: now,
    result: {
      status: "FAILURE",
      httpStatus: null,
      responseTimeMs: 0,
      requestedUrl: monitor.normalizedUrl,
      finalUrl: monitor.normalizedUrl,
      redirectCount: 0,
      resolvedIp: null,
      errorType: "AMBIGUOUS_SUBMISSION",
      errorMessage:
        "Submission result could not be confirmed. The previous submission may have reached the website.",
      formDetail: {
        submissionId: attempt.submissionId,
        submissionState: "AMBIGUOUS",
        successConfirmed: false,
        submissionDurationMs: null,
        submitHttpStatus: null,
        submitEndpointPath: null,
        submitMethod: null,
        fieldsExpectedCount: 0,
        fieldsFoundCount: 0,
        formFound: false,
        submitClicked: true,
        captchaDetected: false,
        validationErrors: null,
        unmappedRequiredFields: null,
      },
    },
  });
  await completeFormSubmissionAttempt({
    attemptId: attempt.attemptId,
    checkId,
    state: "AMBIGUOUS",
  });
  return "completed";
}

async function saveValidation(
  configId: string,
  snapshot: Prisma.InputJsonValue,
): Promise<void> {
  const record = snapshot as { ok?: boolean };
  await database.formMonitorConfig.update({
    where: { id: configId },
    data: {
      lastValidatedAt: new Date(),
      lastValidationResult: snapshot,
      configurationStatus: record.ok ? "UNVERIFIED" : "INVALID",
    },
  });
}

async function updateConfigurationAfterCheck(
  configId: string | undefined,
  errorType: string | null,
): Promise<void> {
  if (!configId) return;
  if (errorType == null) {
    await database.formMonitorConfig.update({
      where: { id: configId },
      data: { configurationStatus: "VERIFIED" },
    });
    return;
  }
  if (
    errorType === "INVALID_MONITOR_CONFIGURATION" ||
    errorType === "UNSUPPORTED_CAPTCHA" ||
    errorType === "UNSUPPORTED_FORM_TYPE"
  ) {
    await database.formMonitorConfig.update({
      where: { id: configId },
      data: { configurationStatus: "INVALID" },
    });
  }
}

export function getFormWorkerConcurrency(): number {
  return getFormMonitoringConfig().workerConcurrency;
}
