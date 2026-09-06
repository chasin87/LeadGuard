import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { Prisma } from "@/generated/prisma/client";
import type {
  GoogleAdsConversionExportStatus,
  GoogleAdsConversionOutOfSyncReason,
} from "@/generated/prisma/enums";
import { getServerEnvironment } from "@/lib/env";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { decryptClickId } from "@/server/tracking/click-crypto";
import { identifierTypesLabel } from "@/server/google-ads/conversion-actions";
import { evaluateGoogleConversionEligibility } from "@/server/google-ads/conversion-eligibility";
import { incrementGoogleConversionMetric } from "@/server/google-ads/conversion-metrics";
import { capabilitiesFromGrantedScopes } from "@/server/google-ads/scopes";
import { refreshGoogleConnectionAccessToken } from "@/server/google-ads/tokens";
import { getGoogleConversionFeedbackProvider } from "@/server/google-data-manager/clients";
import {
  conversionEligibilityPolicy,
  getGoogleDataManagerConfig,
} from "@/server/google-data-manager/config";
import { classifyPrimaryDiagnostic } from "@/server/google-data-manager/diagnostics";
import { DataManagerProviderError } from "@/server/google-data-manager/errors";
import { toDataManagerConversionValue } from "@/server/google-data-manager/value";
import type { DataManagerAdIdentifiers } from "@/server/google-data-manager/types";

const logger = createLogger("google-conversion");
const submitLockClass = 904_216;
let lockPool: Pool | undefined;

function getLockPool(): Pool {
  lockPool ??= new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 8,
    application_name: "leadguard-google-conversion-lock",
  });
  return lockPool;
}

export async function disconnectGoogleConversionLocks(): Promise<void> {
  if (!lockPool) return;
  await lockPool.end();
  lockPool = undefined;
}

async function withExportLock<T>(
  exportId: string,
  fn: () => Promise<T>,
): Promise<T | "locked"> {
  const client = await getLockPool().connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1), $2) AS locked",
      [exportId, submitLockClass],
    );
    if (!result.rows[0]?.locked) return "locked";
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1), $2)", [
        exportId,
        submitLockClass,
      ]);
    }
  } finally {
    client.release();
  }
}

export function newConversionTransactionId(): string {
  return `lgc_${randomBytes(16).toString("hex")}`;
}

export function toRfc3339Utc(date: Date): string {
  return date.toISOString();
}

function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(1_000, exp / 4));
  return exp + jitter;
}

type PlanReason = "outcome" | "manual" | "scheduler";

async function loadPlanContext(leadId: string, organizationId: string) {
  return database.lead.findFirst({
    where: { id: leadId, organizationId },
    include: {
      outcome: true,
      attribution: {
        include: {
          primaryTouch: true,
        },
      },
      website: {
        include: {
          googleAdsConversionFeedbackConfig: {
            include: {
              connection: true,
              customer: true,
            },
          },
        },
      },
    },
  });
}

function snapshotFromEligibility(input: {
  wonAt: Date;
  sendValue: boolean;
  revenueAmountMinor: bigint | null;
  revenueCurrencyCode: string | null;
  hasGclid: boolean;
  hasGbraid: boolean;
  hasWbraid: boolean;
}) {
  return {
    conversionTimestamp: input.wonAt,
    valueAmountMinor: input.sendValue ? input.revenueAmountMinor : null,
    currencyCode: input.sendValue ? input.revenueCurrencyCode : null,
    identifierTypes: identifierTypesLabel(input),
  };
}

const preSubmit: GoogleAdsConversionExportStatus[] = [
  "PENDING",
  "BLOCKED",
  "READY",
  "RETRYABLE_ERROR",
];
const postSubmit: GoogleAdsConversionExportStatus[] = [
  "SUBMITTING",
  "PROCESSING",
  "SUCCEEDED",
];

export async function planGoogleConversionExport(input: {
  leadId: string;
  organizationId: string;
  reason?: PlanReason;
  enqueueSubmit?: (exportId: string) => Promise<unknown>;
}) {
  const lead = await loadPlanContext(input.leadId, input.organizationId);
  if (!lead?.outcome || !lead.attribution) return null;
  const config = lead.website.googleAdsConversionFeedbackConfig;
  const touch = lead.attribution.primaryTouch;
  const connection = config?.connection;
  const capabilities = capabilitiesFromGrantedScopes(
    connection?.grantedScopes,
    connection?.status ?? "DISCONNECTED",
  );
  const eligibility = evaluateGoogleConversionEligibility({
    outcomeStatus: lead.outcome.status,
    wonAt: lead.outcome.wonAt,
    leadOccurredAt: lead.occurredAt,
    now: new Date(),
    hasGclid: touch?.hasGclid ?? false,
    hasGbraid: touch?.hasGbraid ?? false,
    hasWbraid: touch?.hasWbraid ?? false,
    configStatus: config?.status ?? null,
    dataManagerReady: capabilities.dataManagerStatus === "READY",
    valuePolicy: config?.valuePolicy ?? null,
    revenueAmountMinor: lead.outcome.revenueAmountMinor,
    revenueCurrencyCode: lead.outcome.revenueCurrencyCode,
    clickThroughLookbackDays: config?.clickThroughLookbackDays ?? null,
    countingType: config?.conversionActionCountingType ?? null,
  });

  const existing = config
    ? await database.googleAdsConversionExport.findUnique({
        where: {
          leadId_conversionActionId: {
            leadId: lead.id,
            conversionActionId: config.conversionActionId,
          },
        },
      })
    : await database.googleAdsConversionExport.findFirst({
        where: { leadId: lead.id },
        orderBy: { createdAt: "desc" },
      });

  if (existing && postSubmit.includes(existing.status)) {
    if (lead.outcome.status !== "WON") {
      return markOutOfSync(existing.id, "OUTCOME_REVERSED_AFTER_EXPORT");
    }
    if (
      existing.valueAmountMinor !== lead.outcome.revenueAmountMinor ||
      existing.currencyCode !== lead.outcome.revenueCurrencyCode
    ) {
      if (
        existing.status === "SUCCEEDED" ||
        existing.status === "PROCESSING" ||
        existing.status === "SUBMITTING"
      ) {
        return markOutOfSync(existing.id, "REVENUE_CHANGED_AFTER_EXPORT");
      }
    }
    return existing;
  }

  if (
    eligibility.code === "INELIGIBLE_NOT_GOOGLE_ATTRIBUTED" ||
    eligibility.code === "INELIGIBLE_NOT_WON" ||
    eligibility.code === "INELIGIBLE_NO_ACTIVE_CONFIG"
  ) {
    if (existing && preSubmit.includes(existing.status)) {
      return cancelExport(existing.id, eligibility.blockReason);
    }
    return null;
  }

  if (!config || !touch || !lead.outcome.wonAt) {
    if (existing && preSubmit.includes(existing.status)) {
      return cancelExport(existing.id, eligibility.blockReason);
    }
    return null;
  }

  const snapshot = snapshotFromEligibility({
    wonAt: lead.outcome.wonAt,
    sendValue: eligibility.sendValue,
    revenueAmountMinor: lead.outcome.revenueAmountMinor,
    revenueCurrencyCode: lead.outcome.revenueCurrencyCode,
    hasGclid: touch.hasGclid,
    hasGbraid: touch.hasGbraid,
    hasWbraid: touch.hasWbraid,
  });
  const nextStatus: GoogleAdsConversionExportStatus =
    eligibility.code === "ELIGIBLE"
      ? "READY"
      : eligibility.code === "BLOCKED_NO_REVENUE"
        ? "BLOCKED"
        : "BLOCKED";

  if (existing) {
    const updated = await database.googleAdsConversionExport.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        blockReason: eligibility.blockReason,
        ...snapshot,
        eventSource: config.eventSource,
        configId: config.id,
        googleAdsCustomerId: config.customer.googleCustomerId,
        conversionActionId: config.conversionActionId,
        nextAttemptAt: nextStatus === "READY" ? new Date() : null,
      },
    });
    logger.info("google_conversion.export.updated", {
      organizationId: lead.organizationId,
      websiteId: lead.websiteId,
      leadId: lead.id,
      exportId: updated.id,
      configId: config.id,
      googleAdsCustomerId: config.customer.googleCustomerId,
      conversionActionId: config.conversionActionId,
      identifierType: snapshot.identifierTypes,
      hasValue: snapshot.valueAmountMinor !== null,
      currency: snapshot.currencyCode,
    });
    if (nextStatus === "READY" && input.enqueueSubmit) {
      await input.enqueueSubmit(updated.id);
    }
    return updated;
  }

  try {
    const created = await database.googleAdsConversionExport.create({
      data: {
        organizationId: lead.organizationId,
        websiteId: lead.websiteId,
        leadId: lead.id,
        leadOutcomeId: lead.outcome.id,
        leadAttributionId: lead.attribution.id,
        configId: config.id,
        googleAdsCustomerId: config.customer.googleCustomerId,
        conversionActionId: config.conversionActionId,
        transactionId: newConversionTransactionId(),
        status: nextStatus,
        blockReason: eligibility.blockReason,
        ...snapshot,
        eventSource: config.eventSource,
        nextAttemptAt: nextStatus === "READY" ? new Date() : null,
      },
    });
    incrementGoogleConversionMetric("google_conversion_exports_created");
    logger.info("google_conversion.export.created", {
      organizationId: lead.organizationId,
      websiteId: lead.websiteId,
      leadId: lead.id,
      exportId: created.id,
      configId: config.id,
      googleAdsCustomerId: config.customer.googleCustomerId,
      conversionActionId: config.conversionActionId,
      identifierType: snapshot.identifierTypes,
      hasValue: snapshot.valueAmountMinor !== null,
      currency: snapshot.currencyCode,
    });
    if (nextStatus === "READY" && input.enqueueSubmit) {
      await input.enqueueSubmit(created.id);
    }
    return created;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return database.googleAdsConversionExport.findUnique({
        where: {
          leadId_conversionActionId: {
            leadId: lead.id,
            conversionActionId: config.conversionActionId,
          },
        },
      });
    }
    throw error;
  }
}

async function cancelExport(exportId: string, blockReason: string | null) {
  const updated = await database.googleAdsConversionExport.update({
    where: { id: exportId },
    data: {
      status: "CANCELLED",
      blockReason,
      completedAt: new Date(),
      nextAttemptAt: null,
    },
  });
  logger.info("google_conversion.export.cancelled", {
    exportId,
    organizationId: updated.organizationId,
    websiteId: updated.websiteId,
    leadId: updated.leadId,
    configId: updated.configId,
  });
  return updated;
}

async function markOutOfSync(
  exportId: string,
  reason: GoogleAdsConversionOutOfSyncReason,
) {
  const updated = await database.googleAdsConversionExport.update({
    where: { id: exportId },
    data: {
      status: "OUT_OF_SYNC",
      outOfSyncReason: reason,
      completedAt: new Date(),
      nextAttemptAt: null,
    },
  });
  incrementGoogleConversionMetric("google_conversion_exports_out_of_sync");
  logger.info("google_conversion.export.out_of_sync", {
    exportId,
    organizationId: updated.organizationId,
    websiteId: updated.websiteId,
    leadId: updated.leadId,
    configId: updated.configId,
    reason,
  });
  return updated;
}

function decryptIdentifiers(touch: {
  encryptedGclid: string | null;
  encryptedGbraid: string | null;
  encryptedWbraid: string | null;
  hasGclid: boolean;
  hasGbraid: boolean;
  hasWbraid: boolean;
}): DataManagerAdIdentifiers | "decrypt_failure" | "missing" {
  try {
    const identifiers: DataManagerAdIdentifiers = {};
    if (touch.hasGclid) {
      if (!touch.encryptedGclid) return "missing";
      identifiers.gclid = decryptClickId(touch.encryptedGclid);
    }
    if (touch.hasGbraid) {
      if (!touch.encryptedGbraid) return "missing";
      identifiers.gbraid = decryptClickId(touch.encryptedGbraid);
    }
    if (touch.hasWbraid) {
      if (!touch.encryptedWbraid) return "missing";
      identifiers.wbraid = decryptClickId(touch.encryptedWbraid);
    }
    if (!identifiers.gclid && !identifiers.gbraid && !identifiers.wbraid) {
      return "missing";
    }
    return identifiers;
  } catch {
    return "decrypt_failure";
  }
}

export async function submitGoogleConversionExport(input: {
  exportId: string;
  enqueueStatus?: (exportId: string, delaySeconds?: number) => Promise<unknown>;
}) {
  const locked = await withExportLock(input.exportId, async () => {
    const row = await database.googleAdsConversionExport.findUnique({
      where: { id: input.exportId },
      include: {
        config: { include: { connection: true, customer: true } },
        lead: {
          include: {
            outcome: true,
            attribution: { include: { primaryTouch: true } },
          },
        },
      },
    });
    if (!row) return null;
    if (row.dataManagerRequestId) {
      if (input.enqueueStatus) await input.enqueueStatus(row.id, 0);
      return row;
    }
    if (row.status !== "READY" && row.status !== "RETRYABLE_ERROR") {
      return row;
    }
    if (!row.lead || row.lead.outcome?.status !== "WON") {
      return cancelExport(row.id, "OUTCOME_REVERSED");
    }
    const touch = row.lead.attribution?.primaryTouch;
    if (!touch) {
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "CANCELLED",
          blockReason: "NO_IDENTIFIER",
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });
    }
    const identifiers = decryptIdentifiers(touch);
    if (identifiers === "missing") {
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "CANCELLED",
          blockReason: "NO_IDENTIFIER",
          lastErrorCode: "NO_IDENTIFIER",
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });
    }
    if (identifiers === "decrypt_failure") {
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "NEEDS_REVIEW",
          lastErrorCode: "DECRYPT_FAILURE",
          lastErrorCategory: "NEEDS_REVIEW",
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });
    }
    const connection = row.config.connection;
    const capabilities = capabilitiesFromGrantedScopes(
      connection.grantedScopes,
      connection.status,
    );
    if (capabilities.dataManagerStatus !== "READY") {
      await database.googleAdsConversionFeedbackConfig.update({
        where: { id: row.configId },
        data: { status: "NEEDS_REAUTH" },
      });
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "BLOCKED",
          blockReason: "NO_DATA_MANAGER_SCOPE",
          nextAttemptAt: null,
        },
      });
    }

    await database.googleAdsConversionExport.update({
      where: { id: row.id },
      data: {
        status: "SUBMITTING",
        snapshotLockedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
    await database.googleAdsConversionExportAttempt.create({
      data: {
        exportId: row.id,
        attemptNumber: row.attemptCount + 1,
        kind: "SUBMIT",
      },
    });

    let accessToken: string;
    try {
      accessToken = await refreshGoogleConnectionAccessToken(connection);
    } catch {
      await database.googleAdsConnection.update({
        where: { id: connection.id },
        data: { dataManagerStatus: "REAUTH_REQUIRED" },
      });
      await database.googleAdsConversionFeedbackConfig.update({
        where: { id: row.configId },
        data: { status: "NEEDS_REAUTH" },
      });
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "BLOCKED",
          blockReason: "CONNECTION_REAUTH_REQUIRED",
          lastErrorCode: "AUTH_FAILURE",
          lastErrorCategory: "CONFIGURATION",
          nextAttemptAt: null,
        },
      });
    }

    const event: {
      transactionId: string;
      eventTimestamp: string;
      eventSource: typeof row.eventSource;
      adIdentifiers: DataManagerAdIdentifiers;
      conversionValue?: number;
      currency?: string;
    } = {
      transactionId: row.transactionId,
      eventTimestamp: toRfc3339Utc(row.conversionTimestamp),
      eventSource: row.eventSource,
      adIdentifiers: identifiers,
    };
    if (row.valueAmountMinor !== null && row.currencyCode) {
      const serialized = toDataManagerConversionValue(
        row.valueAmountMinor,
        row.currencyCode,
      );
      event.conversionValue = serialized.conversionValue;
      event.currency = serialized.currency;
    }
    const loginCustomerId = row.config.customer.loginCustomerId;
    incrementGoogleConversionMetric("google_data_manager_requests");
    try {
      const result =
        await getGoogleConversionFeedbackProvider().ingestConversion(
          accessToken,
          {
            destination: {
              operatingAccount: {
                accountId: row.googleAdsCustomerId,
                accountType: "GOOGLE_ADS",
              },
              loginAccount: loginCustomerId
                ? { accountId: loginCustomerId, accountType: "GOOGLE_ADS" }
                : undefined,
              productDestinationId: row.conversionActionId,
            },
            event,
          },
        );
      const updated = await database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "PROCESSING",
          dataManagerRequestId: result.requestId,
          submittedAt: new Date(),
          nextAttemptAt: new Date(
            Date.now() +
              getGoogleDataManagerConfig().statusPollInitialSeconds * 1000,
          ),
        },
      });
      incrementGoogleConversionMetric("google_conversion_exports_submitted");
      logger.info("google_conversion.export.submitted", {
        organizationId: row.organizationId,
        websiteId: row.websiteId,
        leadId: row.leadId,
        exportId: row.id,
        configId: row.configId,
        googleAdsCustomerId: row.googleAdsCustomerId,
        conversionActionId: row.conversionActionId,
        identifierType: row.identifierTypes,
        hasValue: row.valueAmountMinor !== null,
        currency: row.currencyCode,
      });
      if (input.enqueueStatus) {
        await input.enqueueStatus(
          row.id,
          getGoogleDataManagerConfig().statusPollInitialSeconds,
        );
      }
      return updated;
    } catch (error) {
      incrementGoogleConversionMetric("google_data_manager_errors");
      if (error instanceof DataManagerProviderError) {
        if (error.authFailure) {
          await database.googleAdsConnection.update({
            where: { id: connection.id },
            data: { dataManagerStatus: "REAUTH_REQUIRED" },
          });
          await database.googleAdsConversionFeedbackConfig.update({
            where: { id: row.configId },
            data: { status: "NEEDS_REAUTH" },
          });
          return database.googleAdsConversionExport.update({
            where: { id: row.id },
            data: {
              status: "BLOCKED",
              blockReason: "CONNECTION_REAUTH_REQUIRED",
              lastErrorCode: error.code,
              lastErrorCategory: "CONFIGURATION",
              nextAttemptAt: null,
            },
          });
        }
        if (error.duplicateTransactionId) {
          if (row.attemptCount >= 1) {
            const updated = await database.googleAdsConversionExport.update({
              where: { id: row.id },
              data: {
                status: "SUCCEEDED",
                lastErrorCode: "DUPLICATE_TRANSACTION_ID",
                lastErrorCategory: "DUPLICATE",
                submittedAt: row.submittedAt ?? new Date(),
                completedAt: new Date(),
                nextAttemptAt: null,
              },
            });
            incrementGoogleConversionMetric(
              "google_conversion_exports_succeeded",
            );
            logger.info("google_conversion.export.succeeded", {
              organizationId: row.organizationId,
              websiteId: row.websiteId,
              leadId: row.leadId,
              exportId: row.id,
              configId: row.configId,
              googleAdsCustomerId: row.googleAdsCustomerId,
              conversionActionId: row.conversionActionId,
              identifierType: row.identifierTypes,
              hasValue: row.valueAmountMinor !== null,
              currency: row.currencyCode,
              duplicate: true,
            });
            return updated;
          }
          return database.googleAdsConversionExport.update({
            where: { id: row.id },
            data: {
              status: "NEEDS_REVIEW",
              lastErrorCode: "DUPLICATE_TRANSACTION_ID",
              lastErrorCategory: "NEEDS_REVIEW",
              completedAt: new Date(),
              nextAttemptAt: null,
            },
          });
        }
        if (error.retryable || error.acceptedWithoutRequestId) {
          incrementGoogleConversionMetric(
            "google_conversion_exports_retryable",
          );
          const delay = backoffMs(
            row.attemptCount + 1,
            getGoogleDataManagerConfig().jobRetryDelaySeconds * 1000,
            30 * 60 * 1000,
          );
          return database.googleAdsConversionExport.update({
            where: { id: row.id },
            data: {
              status: "RETRYABLE_ERROR",
              lastErrorCode: error.code,
              lastErrorCategory: "RETRYABLE",
              nextAttemptAt: new Date(Date.now() + delay),
            },
          });
        }
      }
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "NEEDS_REVIEW",
          lastErrorCode:
            error instanceof DataManagerProviderError ? error.code : "UNKNOWN",
          lastErrorCategory: "NEEDS_REVIEW",
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });
    }
  });
  return locked === "locked" ? null : locked;
}

export async function pollGoogleConversionExportStatus(input: {
  exportId: string;
  enqueueStatus?: (exportId: string, delaySeconds?: number) => Promise<unknown>;
}) {
  const locked = await withExportLock(input.exportId, async () => {
    const row = await database.googleAdsConversionExport.findUnique({
      where: { id: input.exportId },
      include: {
        config: { include: { connection: true, customer: true } },
      },
    });
    if (!row) return null;
    if (!row.dataManagerRequestId) {
      if (row.status === "RETRYABLE_ERROR" || row.status === "READY") {
        return row;
      }
      return row;
    }
    if (row.status !== "PROCESSING" && row.status !== "SUBMITTING") {
      return row;
    }
    let accessToken: string;
    try {
      accessToken = await refreshGoogleConnectionAccessToken(
        row.config.connection,
      );
    } catch {
      await database.googleAdsConnection.update({
        where: { id: row.config.connection.id },
        data: { dataManagerStatus: "REAUTH_REQUIRED" },
      });
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "BLOCKED",
          blockReason: "CONNECTION_REAUTH_REQUIRED",
          nextAttemptAt: null,
        },
      });
    }
    incrementGoogleConversionMetric("google_data_manager_requests");
    const status =
      await getGoogleConversionFeedbackProvider().getIngestionStatus(
        accessToken,
        row.dataManagerRequestId,
      );
    await database.googleAdsConversionExportAttempt.create({
      data: {
        exportId: row.id,
        attemptNumber: row.attemptCount,
        kind: "STATUS",
        dataManagerRequestId: row.dataManagerRequestId,
        errorCode: status.errorReasons[0]?.reason ?? null,
      },
    });
    const now = new Date();
    if (status.requestStatus === "PROCESSING") {
      const submittedAt = row.submittedAt ?? row.createdAt;
      if (
        now.getTime() - submittedAt.getTime() >
        conversionEligibilityPolicy.processingPollHorizonMs
      ) {
        return database.googleAdsConversionExport.update({
          where: { id: row.id },
          data: {
            status: "NEEDS_REVIEW",
            lastErrorCode: "PROCESSING_TIMEOUT",
            lastErrorCategory: "NEEDS_REVIEW",
            lastStatusCheckedAt: now,
            completedAt: now,
            nextAttemptAt: null,
          },
        });
      }
      const delay = backoffMs(
        Math.max(1, row.attemptCount),
        getGoogleDataManagerConfig().statusPollInitialSeconds * 1000 || 1_000,
        getGoogleDataManagerConfig().statusPollMaxSeconds * 1000,
      );
      const updated = await database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "PROCESSING",
          lastStatusCheckedAt: now,
          nextAttemptAt: new Date(now.getTime() + delay),
        },
      });
      logger.info("google_conversion.export.processing", {
        organizationId: row.organizationId,
        websiteId: row.websiteId,
        leadId: row.leadId,
        exportId: row.id,
        configId: row.configId,
        googleAdsCustomerId: row.googleAdsCustomerId,
        conversionActionId: row.conversionActionId,
        identifierType: row.identifierTypes,
      });
      if (input.enqueueStatus) {
        await input.enqueueStatus(row.id, Math.ceil(delay / 1000));
      }
      return updated;
    }
    if (status.requestStatus === "SUCCESS") {
      const updated = await database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "SUCCEEDED",
          lastStatusCheckedAt: now,
          completedAt: now,
          nextAttemptAt: null,
          lastWarningCodes:
            status.warningReasons.map((item) => item.reason).join(",") || null,
        },
      });
      incrementGoogleConversionMetric("google_conversion_exports_succeeded");
      logger.info("google_conversion.export.succeeded", {
        organizationId: row.organizationId,
        websiteId: row.websiteId,
        leadId: row.leadId,
        exportId: row.id,
        configId: row.configId,
        googleAdsCustomerId: row.googleAdsCustomerId,
        conversionActionId: row.conversionActionId,
        identifierType: row.identifierTypes,
        hasValue: row.valueAmountMinor !== null,
        currency: row.currencyCode,
      });
      return updated;
    }
    if (status.requestStatus === "PARTIAL_SUCCESS") {
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "NEEDS_REVIEW",
          lastErrorCode: "PARTIAL_SUCCESS",
          lastErrorCategory: "NEEDS_REVIEW",
          lastStatusCheckedAt: now,
          completedAt: now,
          nextAttemptAt: null,
        },
      });
    }
    const reasons = status.errorReasons.map((item) => item.reason);
    const primary = classifyPrimaryDiagnostic(reasons);
    if (primary.category === "DELAYED") {
      const maxAttempts =
        primary.reason === "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK"
          ? conversionEligibilityPolicy.tooRecentClickMaxAttempts
          : conversionEligibilityPolicy.clickNotFoundMaxAttempts;
      const base =
        primary.reason === "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK"
          ? conversionEligibilityPolicy.tooRecentClickBaseDelayMs
          : conversionEligibilityPolicy.clickNotFoundBaseDelayMs;
      if (row.attemptCount >= maxAttempts) {
        incrementGoogleConversionMetric("google_conversion_exports_rejected");
        return database.googleAdsConversionExport.update({
          where: { id: row.id },
          data: {
            status: "REJECTED",
            lastErrorCode: primary.reason,
            lastErrorCategory: "PERMANENT",
            lastStatusCheckedAt: now,
            completedAt: now,
            nextAttemptAt: null,
          },
        });
      }
      incrementGoogleConversionMetric("google_conversion_exports_retryable");
      return database.googleAdsConversionExport.update({
        where: { id: row.id },
        data: {
          status: "RETRYABLE_ERROR",
          dataManagerRequestId: null,
          lastErrorCode: primary.reason,
          lastErrorCategory: "DELAYED",
          lastStatusCheckedAt: now,
          nextAttemptAt: new Date(now.getTime() + base),
        },
      });
    }
    if (primary.category === "CONFIGURATION") {
      await database.googleAdsConversionFeedbackConfig.update({
        where: { id: row.configId },
        data: { status: "NEEDS_ACTION", lastErrorCode: primary.reason },
      });
    }
    const terminal =
      primary.category === "RETRYABLE"
        ? "RETRYABLE_ERROR"
        : primary.category === "CONSENT" ||
            primary.category === "NEEDS_REVIEW" ||
            primary.category === "DUPLICATE"
          ? "NEEDS_REVIEW"
          : "REJECTED";
    if (terminal === "REJECTED") {
      incrementGoogleConversionMetric("google_conversion_exports_rejected");
    }
    if (terminal === "RETRYABLE_ERROR") {
      incrementGoogleConversionMetric("google_conversion_exports_retryable");
    }
    logger.info(
      terminal === "REJECTED"
        ? "google_conversion.export.rejected"
        : "google_conversion.export.processing",
      {
        organizationId: row.organizationId,
        websiteId: row.websiteId,
        leadId: row.leadId,
        exportId: row.id,
        configId: row.configId,
        googleAdsCustomerId: row.googleAdsCustomerId,
        conversionActionId: row.conversionActionId,
        identifierType: row.identifierTypes,
        errorCode: primary.reason,
      },
    );
    return database.googleAdsConversionExport.update({
      where: { id: row.id },
      data: {
        status: terminal,
        lastErrorCode: primary.reason,
        lastErrorCategory: primary.category,
        lastStatusCheckedAt: now,
        completedAt: terminal === "RETRYABLE_ERROR" ? null : now,
        nextAttemptAt:
          terminal === "RETRYABLE_ERROR"
            ? new Date(
                now.getTime() +
                  backoffMs(
                    row.attemptCount,
                    getGoogleDataManagerConfig().jobRetryDelaySeconds * 1000,
                    30 * 60 * 1000,
                  ),
              )
            : null,
        dataManagerRequestId:
          terminal === "RETRYABLE_ERROR" ? null : row.dataManagerRequestId,
      },
    });
  });
  return locked === "locked" ? null : locked;
}

export async function claimDueConversionExports(now = new Date()) {
  const batch = getGoogleDataManagerConfig().schedulerBatchSize;
  const submitDue = await database.googleAdsConversionExport.findMany({
    where: {
      status: { in: ["READY", "RETRYABLE_ERROR"] },
      nextAttemptAt: { lte: now },
      dataManagerRequestId: null,
    },
    select: { id: true },
    take: batch,
    orderBy: { nextAttemptAt: "asc" },
  });
  const statusDue = await database.googleAdsConversionExport.findMany({
    where: {
      status: "PROCESSING",
      dataManagerRequestId: { not: null },
      nextAttemptAt: { lte: now },
    },
    select: { id: true },
    take: batch,
    orderBy: { nextAttemptAt: "asc" },
  });
  return { submitDue, statusDue };
}
