import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type {
  ExternalLeadMatchMethod,
  ExternalOutcomeEventStatus,
} from "@/generated/prisma/enums";
import { database } from "@/server/database";
import {
  DomainError,
  LeadNotFoundError,
  OutcomeVersionConflictError,
} from "@/server/authorization/errors";
import { createLogger } from "@/server/logger";
import { MoneyParseError, parseMoney } from "@/lib/money";
import { calculateLeadOutcomeMutation } from "@/server/leads/outcome";
import {
  executeLeadOutcomeMutation,
  prepareLeadOutcomeMutation,
} from "@/server/leads/service";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";
import { incrementOutcomeIngestionMetric } from "@/server/outcomes/metrics";
import { matchExternalOutcomeToLead } from "@/server/outcomes/matcher";
import { evaluateExternalOutcomeFreshness } from "@/server/outcomes/freshness";
import { mutationIdForExternalEvent } from "@/server/outcomes/mutation-id";
import {
  mapDomainErrorToIngestionCode,
  type OutcomeIngestionErrorCode,
} from "@/server/outcomes/normalize";
import type { AuthenticatedOutcomeIntegration } from "@/server/outcomes/auth";
import type { NormalizedExternalOutcomeEvent } from "@/server/outcomes/types";

const logger = createLogger("outcome-ingestion");

export type IngestOutcomeResult = {
  eventId: string;
  status: ExternalOutcomeEventStatus;
  leadId: string | null;
  errorCode: OutcomeIngestionErrorCode | null;
  externalEventId: string | null;
};

async function loadAllowedWebsiteIds(integrationId: string): Promise<string[]> {
  const rows = await database.externalOutcomeIntegrationWebsite.findMany({
    where: { integrationId },
    select: { websiteId: true },
  });
  return rows.map((row) => row.websiteId);
}

async function lockSourceRecord(
  tx: Prisma.TransactionClient,
  integrationId: string,
  sourceRecordId: string | null,
  sourceEventId: string,
) {
  const material = `${integrationId}:${sourceRecordId ?? `event:${sourceEventId}`}`;
  const digest = createHash("sha256").update(material, "utf8").digest();
  const a = digest.readInt32BE(0);
  const b = digest.readInt32BE(4);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${a}, ${b})`;
}

function parseIncomingRevenue(event: NormalizedExternalOutcomeEvent): {
  amountMinor: bigint | null;
  currencyCode: string | null;
  revenue?: { amount: string; currency: string };
} {
  if (!event.revenueAmount && !event.revenueCurrency) {
    return { amountMinor: null, currencyCode: null };
  }
  if (!event.revenueAmount || !event.revenueCurrency) {
    throw new DomainError("Revenue requires amount and currency.");
  }
  const parsed = parseMoney(event.revenueAmount, event.revenueCurrency);
  return {
    amountMinor: parsed.amountMinor,
    currencyCode: parsed.currencyCode,
    revenue: { amount: event.revenueAmount, currency: parsed.currencyCode },
  };
}

function toResult(
  eventId: string,
  status: ExternalOutcomeEventStatus,
  extras: {
    leadId?: string | null;
    errorCode?: OutcomeIngestionErrorCode | null;
    externalEventId?: string | null;
  } = {},
): IngestOutcomeResult {
  return {
    eventId,
    status,
    leadId: extras.leadId ?? null,
    errorCode: extras.errorCode ?? null,
    externalEventId: extras.externalEventId ?? null,
  };
}

async function persistEventStatus(
  tx: Prisma.TransactionClient,
  eventRowId: string,
  data: {
    status: ExternalOutcomeEventStatus;
    errorCode?: string | null;
    matchMethod?: ExternalLeadMatchMethod | null;
    matchedLeadId?: string | null;
    appliedOutcomeEventId?: string | null;
    processedAt?: Date;
  },
) {
  await tx.externalOutcomeEvent.update({
    where: { id: eventRowId },
    data: {
      status: data.status,
      errorCode: data.errorCode ?? null,
      matchMethod: data.matchMethod ?? undefined,
      matchedLeadId: data.matchedLeadId ?? undefined,
      appliedOutcomeEventId: data.appliedOutcomeEventId ?? undefined,
      processedAt: data.processedAt ?? new Date(),
    },
  });
}

export async function ingestNormalizedOutcomeEvent(input: {
  integration: AuthenticatedOutcomeIntegration;
  event: NormalizedExternalOutcomeEvent;
  outcomeSource: "API" | "CSV_IMPORT";
  persist: boolean;
  now?: Date;
}): Promise<IngestOutcomeResult> {
  incrementOutcomeIngestionMetric("outcome_ingestion_events_total");
  const now = input.now ?? new Date();
  const event = input.event;
  if (input.integration.status !== "ENABLED") {
    return toResult(event.sourceEventId, "REJECTED", {
      errorCode: "INTEGRATION_DISABLED",
    });
  }

  let parsedRevenue: ReturnType<typeof parseIncomingRevenue>;
  try {
    parsedRevenue = parseIncomingRevenue(event);
  } catch (error) {
    const message =
      error instanceof MoneyParseError || error instanceof DomainError
        ? error.message
        : "Invalid revenue.";
    const code =
      error instanceof MoneyParseError || error instanceof DomainError
        ? mapDomainErrorToIngestionCode(message)
        : "INVALID_REVENUE";
    logger.info("outcome_ingestion.rejected", {
      organizationId: input.integration.organizationId,
      integrationId: input.integration.id,
      errorCode: code,
    });
    if (!input.persist) {
      return toResult(event.sourceEventId, "REJECTED", { errorCode: code });
    }
    return persistRejected(input, event, code, now);
  }

  if (!input.persist) {
    return evaluateWithoutPersist({
      integration: input.integration,
      event,
      parsedRevenue,
      outcomeSource: input.outcomeSource,
      now,
    });
  }

  return persistAndApply({
    integration: input.integration,
    event,
    parsedRevenue,
    outcomeSource: input.outcomeSource,
    now,
  });
}

async function persistRejected(
  input: {
    integration: AuthenticatedOutcomeIntegration;
  },
  event: NormalizedExternalOutcomeEvent,
  code: OutcomeIngestionErrorCode,
  now: Date,
): Promise<IngestOutcomeResult> {
  try {
    const created = await database.externalOutcomeEvent.create({
      data: {
        organizationId: input.integration.organizationId,
        integrationId: input.integration.id,
        sourceSystem: event.sourceSystem,
        sourceEventId: event.sourceEventId,
        sourceRecordId: event.sourceRecordId,
        sourceVersion: event.sourceVersion,
        externalLeadId: event.externalLeadId,
        publicLeadId: event.publicLeadId,
        normalizedStatus: event.status,
        effectiveAt: event.effectiveAt,
        hasRevenue: Boolean(event.revenueAmount),
        status: "REJECTED",
        errorCode: code,
        receivedAt: now,
        processedAt: now,
      },
    });
    return toResult(event.sourceEventId, "REJECTED", {
      errorCode: code,
      externalEventId: created.id,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await database.externalOutcomeEvent.findUnique({
        where: {
          integrationId_sourceEventId: {
            integrationId: input.integration.id,
            sourceEventId: event.sourceEventId,
          },
        },
      });
      if (existing) {
        return toResult(event.sourceEventId, existing.status, {
          leadId: existing.matchedLeadId,
          errorCode: (existing.errorCode as OutcomeIngestionErrorCode) ?? code,
          externalEventId: existing.id,
        });
      }
    }
    throw error;
  }
}

async function evaluateWithoutPersist(input: {
  integration: AuthenticatedOutcomeIntegration;
  event: NormalizedExternalOutcomeEvent;
  parsedRevenue: ReturnType<typeof parseIncomingRevenue>;
  outcomeSource: "API" | "CSV_IMPORT";
  now: Date;
}): Promise<IngestOutcomeResult> {
  const websiteIds = await loadAllowedWebsiteIds(input.integration.id);
  const match = await resolveMatch(input.integration, input.event, websiteIds);
  if (match.status === "UNMATCHED") {
    incrementOutcomeIngestionMetric("outcome_ingestion_unmatched_total");
    return toResult(input.event.sourceEventId, "UNMATCHED", {
      errorCode: "LEAD_NOT_FOUND",
    });
  }
  if (match.status === "AMBIGUOUS") {
    incrementOutcomeIngestionMetric("outcome_ingestion_unmatched_total");
    return toResult(input.event.sourceEventId, "AMBIGUOUS", {
      errorCode: "AMBIGUOUS_MATCH",
    });
  }
  if (match.status === "CONFLICT") {
    incrementOutcomeIngestionMetric("outcome_ingestion_conflicts_total");
    return toResult(input.event.sourceEventId, "CONFLICT", {
      errorCode: "SOURCE_RECORD_ALREADY_LINKED",
    });
  }
  const lead = await database.lead.findFirst({
    where: {
      id: match.leadId,
      organizationId: input.integration.organizationId,
    },
    include: { outcome: true },
  });
  const outcome = lead?.outcome;
  if (!outcome || !lead) {
    return toResult(input.event.sourceEventId, "UNMATCHED", {
      errorCode: "LEAD_NOT_FOUND",
    });
  }
  const link = input.event.sourceRecordId
    ? await database.externalLeadLink.findUnique({
        where: {
          integrationId_sourceRecordId: {
            integrationId: input.integration.id,
            sourceRecordId: input.event.sourceRecordId,
          },
        },
      })
    : null;
  const freshness = evaluateExternalOutcomeFreshness({
    incomingEffectiveAt: input.event.effectiveAt,
    incomingSourceVersion: input.event.sourceVersion,
    incomingSourceEventId: input.event.sourceEventId,
    incomingStatus: input.event.status,
    incomingRevenueAmountMinor: input.parsedRevenue.amountMinor,
    incomingRevenueCurrencyCode: input.parsedRevenue.currencyCode,
    currentStatus: outcome.status,
    currentStatusChangedAt: outcome.statusChangedAt,
    currentRevenueUpdatedAt: outcome.revenueUpdatedAt,
    currentRevenueAmountMinor: outcome.revenueAmountMinor,
    currentRevenueCurrencyCode: outcome.revenueCurrencyCode,
    lastAppliedEffectiveAt: link?.lastAppliedEffectiveAt ?? null,
    lastAppliedSourceVersion: link?.lastAppliedSourceVersion ?? null,
  });
  if (freshness.decision === "STALE") {
    incrementOutcomeIngestionMetric("outcome_ingestion_stale_total");
    return toResult(input.event.sourceEventId, "STALE", {
      leadId: match.leadId,
      errorCode: "STALE_EVENT",
    });
  }
  if (freshness.decision === "CONFLICT") {
    incrementOutcomeIngestionMetric("outcome_ingestion_conflicts_total");
    return toResult(input.event.sourceEventId, "CONFLICT", {
      leadId: match.leadId,
    });
  }
  let requestedRevenue: Parameters<
    typeof calculateLeadOutcomeMutation
  >[0]["requestedRevenue"] = { kind: "keep" };
  if (input.parsedRevenue.revenue) {
    requestedRevenue = {
      kind: "set",
      amountMinor: input.parsedRevenue.amountMinor!,
      currencyCode: input.parsedRevenue.currencyCode!,
      source: input.outcomeSource,
    };
  }
  const calculated = calculateLeadOutcomeMutation({
    current: {
      status: outcome.status,
      version: outcome.version,
      statusChangedAt: outcome.statusChangedAt,
      qualifiedAt: outcome.qualifiedAt,
      wonAt: outcome.wonAt,
      lostAt: outcome.lostAt,
      revenueAmountMinor: outcome.revenueAmountMinor,
      revenueCurrencyCode: outcome.revenueCurrencyCode,
      revenueSource: outcome.revenueSource,
      revenueUpdatedAt: outcome.revenueUpdatedAt,
    },
    requestedStatus: input.event.status,
    requestedRevenue,
    confirmTerminalTransition: true,
    effectiveAt: input.event.effectiveAt,
    now: input.now,
    leadOccurredAt: lead.occurredAt,
  });
  if (!calculated.ok) {
    return toResult(input.event.sourceEventId, "REJECTED", {
      leadId: match.leadId,
      errorCode: mapDomainErrorToIngestionCode(calculated.message),
    });
  }
  return toResult(input.event.sourceEventId, "APPLIED", {
    leadId: match.leadId,
  });
}

async function persistAndApply(input: {
  integration: AuthenticatedOutcomeIntegration;
  event: NormalizedExternalOutcomeEvent;
  parsedRevenue: ReturnType<typeof parseIncomingRevenue>;
  outcomeSource: "API" | "CSV_IMPORT";
  now: Date;
}): Promise<IngestOutcomeResult> {
  const existing = await database.externalOutcomeEvent.findUnique({
    where: {
      integrationId_sourceEventId: {
        integrationId: input.integration.id,
        sourceEventId: input.event.sourceEventId,
      },
    },
  });
  if (existing && existing.status !== "RECEIVED") {
    return toResult(input.event.sourceEventId, "DUPLICATE", {
      leadId: existing.matchedLeadId,
      errorCode:
        existing.status === "DUPLICATE"
          ? null
          : ((existing.errorCode as OutcomeIngestionErrorCode) ?? null),
      externalEventId: existing.id,
    });
  }

  try {
    return await database.$transaction(async (tx) => {
      await lockSourceRecord(
        tx,
        input.integration.id,
        input.event.sourceRecordId,
        input.event.sourceEventId,
      );
      const eventRow =
        existing ??
        (await tx.externalOutcomeEvent.create({
          data: {
            organizationId: input.integration.organizationId,
            integrationId: input.integration.id,
            sourceSystem: input.event.sourceSystem,
            sourceEventId: input.event.sourceEventId,
            sourceRecordId: input.event.sourceRecordId,
            sourceVersion: input.event.sourceVersion,
            externalLeadId: input.event.externalLeadId,
            publicLeadId: input.event.publicLeadId,
            normalizedStatus: input.event.status,
            effectiveAt: input.event.effectiveAt,
            revenueAmountMinor: input.parsedRevenue.amountMinor,
            revenueCurrencyCode: input.parsedRevenue.currencyCode,
            hasRevenue: input.parsedRevenue.amountMinor !== null,
            status: "RECEIVED",
            receivedAt: input.now,
          },
        }));

      if (eventRow.status !== "RECEIVED") {
        return toResult(input.event.sourceEventId, "DUPLICATE", {
          leadId: eventRow.matchedLeadId,
          externalEventId: eventRow.id,
        });
      }

      const websiteIds = (
        await tx.externalOutcomeIntegrationWebsite.findMany({
          where: { integrationId: input.integration.id },
          select: { websiteId: true },
        })
      ).map((row) => row.websiteId);

      const match = await resolveMatch(
        input.integration,
        input.event,
        websiteIds,
        tx,
      );
      if (match.status === "UNMATCHED") {
        incrementOutcomeIngestionMetric("outcome_ingestion_unmatched_total");
        logger.info("outcome_ingestion.unmatched", {
          organizationId: input.integration.organizationId,
          integrationId: input.integration.id,
          externalEventId: eventRow.id,
        });
        await persistEventStatus(tx, eventRow.id, {
          status: "UNMATCHED",
          errorCode: "LEAD_NOT_FOUND",
        });
        return toResult(input.event.sourceEventId, "UNMATCHED", {
          errorCode: "LEAD_NOT_FOUND",
          externalEventId: eventRow.id,
        });
      }
      if (match.status === "AMBIGUOUS") {
        incrementOutcomeIngestionMetric("outcome_ingestion_unmatched_total");
        logger.info("outcome_ingestion.unmatched", {
          organizationId: input.integration.organizationId,
          integrationId: input.integration.id,
          externalEventId: eventRow.id,
          errorCode: "AMBIGUOUS_MATCH",
        });
        await persistEventStatus(tx, eventRow.id, {
          status: "AMBIGUOUS",
          errorCode: "AMBIGUOUS_MATCH",
        });
        return toResult(input.event.sourceEventId, "AMBIGUOUS", {
          errorCode: "AMBIGUOUS_MATCH",
          externalEventId: eventRow.id,
        });
      }
      if (match.status === "CONFLICT") {
        incrementOutcomeIngestionMetric("outcome_ingestion_conflicts_total");
        logger.info("outcome_ingestion.conflict", {
          organizationId: input.integration.organizationId,
          integrationId: input.integration.id,
          externalEventId: eventRow.id,
        });
        await persistEventStatus(tx, eventRow.id, {
          status: "CONFLICT",
          errorCode: "SOURCE_RECORD_ALREADY_LINKED",
        });
        return toResult(input.event.sourceEventId, "CONFLICT", {
          errorCode: "SOURCE_RECORD_ALREADY_LINKED",
          externalEventId: eventRow.id,
        });
      }

      return applyMatchedEvent({
        tx,
        integration: input.integration,
        event: input.event,
        parsedRevenue: input.parsedRevenue,
        outcomeSource: input.outcomeSource,
        now: input.now,
        eventRowId: eventRow.id,
        leadId: match.leadId,
        matchMethod: match.method,
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await database.externalOutcomeEvent.findUnique({
        where: {
          integrationId_sourceEventId: {
            integrationId: input.integration.id,
            sourceEventId: input.event.sourceEventId,
          },
        },
      });
      if (raced) {
        return toResult(input.event.sourceEventId, "DUPLICATE", {
          leadId: raced.matchedLeadId,
          externalEventId: raced.id,
        });
      }
    }
    throw error;
  }
}

async function applyMatchedEvent(input: {
  tx: Prisma.TransactionClient;
  integration: AuthenticatedOutcomeIntegration;
  event: NormalizedExternalOutcomeEvent;
  parsedRevenue: ReturnType<typeof parseIncomingRevenue>;
  outcomeSource: "API" | "CSV_IMPORT";
  now: Date;
  eventRowId: string;
  leadId: string;
  matchMethod: ExternalLeadMatchMethod;
}): Promise<IngestOutcomeResult> {
  const { tx } = input;
  const config = getOutcomeIngestionConfig();
  let attempt = 0;
  while (attempt < config.maxConcurrencyRetries) {
    attempt += 1;
    const outcome = await tx.leadOutcome.findUnique({
      where: { leadId: input.leadId },
    });
    if (!outcome) {
      await persistEventStatus(tx, input.eventRowId, {
        status: "UNMATCHED",
        errorCode: "LEAD_NOT_FOUND",
        matchMethod: input.matchMethod,
      });
      return toResult(input.event.sourceEventId, "UNMATCHED", {
        errorCode: "LEAD_NOT_FOUND",
        externalEventId: input.eventRowId,
      });
    }
    const link = input.event.sourceRecordId
      ? await tx.externalLeadLink.findUnique({
          where: {
            integrationId_sourceRecordId: {
              integrationId: input.integration.id,
              sourceRecordId: input.event.sourceRecordId,
            },
          },
        })
      : null;
    if (link && link.leadId !== input.leadId) {
      incrementOutcomeIngestionMetric("outcome_ingestion_conflicts_total");
      await persistEventStatus(tx, input.eventRowId, {
        status: "CONFLICT",
        errorCode: "SOURCE_RECORD_ALREADY_LINKED",
        matchMethod: input.matchMethod,
        matchedLeadId: link.leadId,
      });
      return toResult(input.event.sourceEventId, "CONFLICT", {
        leadId: link.leadId,
        errorCode: "SOURCE_RECORD_ALREADY_LINKED",
        externalEventId: input.eventRowId,
      });
    }

    const freshness = evaluateExternalOutcomeFreshness({
      incomingEffectiveAt: input.event.effectiveAt,
      incomingSourceVersion: input.event.sourceVersion,
      incomingSourceEventId: input.event.sourceEventId,
      incomingStatus: input.event.status,
      incomingRevenueAmountMinor: input.parsedRevenue.amountMinor,
      incomingRevenueCurrencyCode: input.parsedRevenue.currencyCode,
      currentStatus: outcome.status,
      currentStatusChangedAt: outcome.statusChangedAt,
      currentRevenueUpdatedAt: outcome.revenueUpdatedAt,
      currentRevenueAmountMinor: outcome.revenueAmountMinor,
      currentRevenueCurrencyCode: outcome.revenueCurrencyCode,
      lastAppliedEffectiveAt: link?.lastAppliedEffectiveAt ?? null,
      lastAppliedSourceVersion: link?.lastAppliedSourceVersion ?? null,
    });
    if (freshness.decision === "STALE") {
      incrementOutcomeIngestionMetric("outcome_ingestion_stale_total");
      logger.info("outcome_ingestion.stale", {
        organizationId: input.integration.organizationId,
        integrationId: input.integration.id,
        externalEventId: input.eventRowId,
        leadId: input.leadId,
      });
      await persistEventStatus(tx, input.eventRowId, {
        status: "STALE",
        errorCode: "STALE_EVENT",
        matchMethod: input.matchMethod,
        matchedLeadId: input.leadId,
      });
      return toResult(input.event.sourceEventId, "STALE", {
        leadId: input.leadId,
        errorCode: "STALE_EVENT",
        externalEventId: input.eventRowId,
      });
    }
    if (freshness.decision === "CONFLICT") {
      incrementOutcomeIngestionMetric("outcome_ingestion_conflicts_total");
      logger.info("outcome_ingestion.conflict", {
        organizationId: input.integration.organizationId,
        integrationId: input.integration.id,
        externalEventId: input.eventRowId,
        leadId: input.leadId,
      });
      await persistEventStatus(tx, input.eventRowId, {
        status: "CONFLICT",
        matchMethod: input.matchMethod,
        matchedLeadId: input.leadId,
      });
      return toResult(input.event.sourceEventId, "CONFLICT", {
        leadId: input.leadId,
        externalEventId: input.eventRowId,
      });
    }

    if (input.event.sourceRecordId && !link) {
      try {
        await tx.externalLeadLink.create({
          data: {
            organizationId: input.integration.organizationId,
            integrationId: input.integration.id,
            leadId: input.leadId,
            sourceSystem: input.event.sourceSystem,
            sourceRecordId: input.event.sourceRecordId,
            matchMethod: input.matchMethod,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const raced = await tx.externalLeadLink.findUnique({
            where: {
              integrationId_sourceRecordId: {
                integrationId: input.integration.id,
                sourceRecordId: input.event.sourceRecordId,
              },
            },
          });
          if (raced && raced.leadId !== input.leadId) {
            incrementOutcomeIngestionMetric(
              "outcome_ingestion_conflicts_total",
            );
            await persistEventStatus(tx, input.eventRowId, {
              status: "CONFLICT",
              errorCode: "SOURCE_RECORD_ALREADY_LINKED",
              matchedLeadId: raced.leadId,
            });
            return toResult(input.event.sourceEventId, "CONFLICT", {
              leadId: raced.leadId,
              errorCode: "SOURCE_RECORD_ALREADY_LINKED",
              externalEventId: input.eventRowId,
            });
          }
        } else {
          throw error;
        }
      }
    }

    try {
      const prepared = await prepareLeadOutcomeMutation({
        actorType: "INTEGRATION",
        organizationId: input.integration.organizationId,
        leadId: input.leadId,
        mutationId: mutationIdForExternalEvent(
          input.integration.id,
          input.event.sourceEventId,
        ),
        expectedVersion: outcome.version,
        status: input.event.status,
        revenue: input.parsedRevenue.revenue,
        effectiveAt: input.event.effectiveAt,
        outcomeSource: input.outcomeSource,
        sourceSystem: input.event.sourceSystem,
        sourceRecordId: input.event.sourceRecordId,
        sourceEventId: input.event.sourceEventId,
      });
      const applied = await executeLeadOutcomeMutation(tx, prepared, input.now);
      await persistEventStatus(tx, input.eventRowId, {
        status: applied.duplicate ? "DUPLICATE" : "APPLIED",
        matchMethod: input.matchMethod,
        matchedLeadId: input.leadId,
        appliedOutcomeEventId: applied.outcomeEventId,
      });
      if (input.event.sourceRecordId) {
        await tx.externalLeadLink.updateMany({
          where: {
            integrationId: input.integration.id,
            sourceRecordId: input.event.sourceRecordId,
            leadId: input.leadId,
          },
          data: {
            lastAppliedEffectiveAt: input.event.effectiveAt,
            lastAppliedSourceEventId: input.event.sourceEventId,
            lastAppliedSourceVersion: input.event.sourceVersion,
            matchMethod: input.matchMethod,
          },
        });
      }
      await tx.externalOutcomeIntegration.update({
        where: { id: input.integration.id },
        data: {
          lastEventReceivedAt: input.now,
          lastAppliedAt: applied.duplicate ? undefined : input.now,
        },
      });
      if (!applied.duplicate) {
        incrementOutcomeIngestionMetric("outcome_ingestion_applied_total");
        logger.info("outcome_ingestion.applied", {
          organizationId: input.integration.organizationId,
          integrationId: input.integration.id,
          externalEventId: input.eventRowId,
          leadId: input.leadId,
        });
      }
      return toResult(
        input.event.sourceEventId,
        applied.duplicate ? "DUPLICATE" : "APPLIED",
        {
          leadId: input.leadId,
          externalEventId: input.eventRowId,
        },
      );
    } catch (error) {
      if (error instanceof OutcomeVersionConflictError) {
        continue;
      }
      if (error instanceof LeadNotFoundError) {
        await persistEventStatus(tx, input.eventRowId, {
          status: "UNMATCHED",
          errorCode: "LEAD_NOT_FOUND",
        });
        return toResult(input.event.sourceEventId, "UNMATCHED", {
          errorCode: "LEAD_NOT_FOUND",
          externalEventId: input.eventRowId,
        });
      }
      if (error instanceof DomainError || error instanceof MoneyParseError) {
        const code = mapDomainErrorToIngestionCode(error.message);
        await persistEventStatus(tx, input.eventRowId, {
          status: "REJECTED",
          errorCode: code,
          matchMethod: input.matchMethod,
          matchedLeadId: input.leadId,
        });
        logger.info("outcome_ingestion.rejected", {
          organizationId: input.integration.organizationId,
          integrationId: input.integration.id,
          externalEventId: input.eventRowId,
          leadId: input.leadId,
          errorCode: code,
        });
        return toResult(input.event.sourceEventId, "REJECTED", {
          leadId: input.leadId,
          errorCode: code,
          externalEventId: input.eventRowId,
        });
      }
      throw error;
    }
  }

  await persistEventStatus(tx, input.eventRowId, {
    status: "CONFLICT",
    errorCode: "OUTCOME_VERSION_CONFLICT",
    matchMethod: input.matchMethod,
    matchedLeadId: input.leadId,
  });
  incrementOutcomeIngestionMetric("outcome_ingestion_conflicts_total");
  return toResult(input.event.sourceEventId, "CONFLICT", {
    leadId: input.leadId,
    errorCode: "OUTCOME_VERSION_CONFLICT",
    externalEventId: input.eventRowId,
  });
}

async function resolveMatch(
  integration: AuthenticatedOutcomeIntegration,
  event: NormalizedExternalOutcomeEvent,
  allowedWebsiteIds: string[],
  tx: Prisma.TransactionClient | typeof database = database,
) {
  const existingLink = event.sourceRecordId
    ? await tx.externalLeadLink.findUnique({
        where: {
          integrationId_sourceRecordId: {
            integrationId: integration.id,
            sourceRecordId: event.sourceRecordId,
          },
        },
      })
    : null;
  const leadsByExternalId =
    event.externalLeadId && allowedWebsiteIds.length > 0
      ? await tx.lead.findMany({
          where: {
            organizationId: integration.organizationId,
            websiteId: { in: allowedWebsiteIds },
            externalLeadId: event.externalLeadId,
          },
          select: {
            id: true,
            organizationId: true,
            websiteId: true,
            publicLeadId: true,
            externalLeadId: true,
          },
        })
      : [];
  const leadByPublicId = event.publicLeadId
    ? await tx.lead.findUnique({
        where: { publicLeadId: event.publicLeadId },
        select: {
          id: true,
          organizationId: true,
          websiteId: true,
          publicLeadId: true,
          externalLeadId: true,
        },
      })
    : null;

  return matchExternalOutcomeToLead({
    organizationId: integration.organizationId,
    allowedWebsiteIds,
    sourceRecordId: event.sourceRecordId,
    externalLeadId: event.externalLeadId,
    publicLeadId: event.publicLeadId,
    existingLink: existingLink
      ? {
          leadId: existingLink.leadId,
          sourceRecordId: existingLink.sourceRecordId,
        }
      : null,
    leadsByExternalId,
    leadByPublicId,
  });
}

export async function ingestParsedOutcomeEvent(input: {
  integration: AuthenticatedOutcomeIntegration;
  parsed: import("@/server/outcomes/normalize").ParsedOutcomeEventInput;
  persist: boolean;
  outcomeSource?: "API" | "CSV_IMPORT";
  now?: Date;
}): Promise<IngestOutcomeResult> {
  return ingestNormalizedOutcomeEvent({
    integration: input.integration,
    event: {
      integrationId: input.integration.id,
      sourceSystem: input.integration.sourceSystem,
      sourceRecordId: input.parsed.sourceRecordId,
      sourceEventId: input.parsed.eventId,
      sourceVersion: input.parsed.sourceVersion,
      externalLeadId: input.parsed.externalLeadId,
      publicLeadId: input.parsed.publicLeadId,
      status: input.parsed.status,
      effectiveAt: input.parsed.effectiveAt,
      revenueAmount: input.parsed.revenueAmount,
      revenueCurrency: input.parsed.revenueCurrency,
    },
    outcomeSource: input.outcomeSource ?? "API",
    persist: input.persist,
    now: input.now,
  });
}
