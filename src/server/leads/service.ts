import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type {
  LeadOutcomeActorType,
  LeadOutcomeSource,
  LeadOutcomeStatus,
} from "@/generated/prisma/enums";
import { database } from "@/server/database";
import {
  AuthorizationError,
  DomainError,
  LeadNotFoundError,
  OutcomeVersionConflictError,
} from "@/server/authorization/errors";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { requireOrganizationMembership } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";
import { incrementLeadOutcomeMetric } from "@/server/leads/metrics";
import { enqueueGoogleConversionPlan } from "@/jobs/queue";
import {
  calculateLeadOutcomeMutation,
  type LeadOutcomeSnapshot,
  type RequestedRevenue,
} from "@/server/leads/outcome";
import { MoneyParseError, parseMoney } from "@/lib/money";

const logger = createLogger("leads");
const MUTATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createInitialLeadOutcome(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    websiteId: string;
    leadId: string;
    occurredAt: Date;
    now: Date;
  },
) {
  const outcome = await tx.leadOutcome.create({
    data: {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      leadId: input.leadId,
      status: "NEW",
      statusChangedAt: input.occurredAt,
      version: 1,
    },
  });
  await tx.leadOutcomeEvent.create({
    data: {
      organizationId: input.organizationId,
      websiteId: input.websiteId,
      leadId: input.leadId,
      outcomeId: outcome.id,
      mutationId: `system-created-${input.leadId}`,
      version: 1,
      changeType: "CREATED",
      beforeStatus: null,
      afterStatus: "NEW",
      source: "SYSTEM",
      actorType: "SYSTEM",
      effectiveAt: input.occurredAt,
    },
  });
  return outcome;
}

function toSnapshot(row: {
  status: LeadOutcomeStatus;
  version: number;
  statusChangedAt: Date;
  qualifiedAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
  revenueAmountMinor: bigint | null;
  revenueCurrencyCode: string | null;
  revenueSource: LeadOutcomeSource | null;
  revenueUpdatedAt: Date | null;
}): LeadOutcomeSnapshot {
  return {
    status: row.status,
    version: row.version,
    statusChangedAt: row.statusChangedAt,
    qualifiedAt: row.qualifiedAt,
    wonAt: row.wonAt,
    lostAt: row.lostAt,
    revenueAmountMinor: row.revenueAmountMinor,
    revenueCurrencyCode: row.revenueCurrencyCode,
    revenueSource: row.revenueSource,
    revenueUpdatedAt: row.revenueUpdatedAt,
  };
}

type SharedLeadOutcomeFields = {
  leadId: string;
  mutationId: string;
  expectedVersion: number;
  status?: LeadOutcomeStatus;
  revenue?: { amount: string; currency: string } | null;
  clearRevenue?: boolean;
  confirmTerminalTransition?: boolean;
  effectiveAt?: Date;
};

export type ApplyLeadOutcomeInput = SharedLeadOutcomeFields &
  (
    | {
        actorType?: "USER";
        userId: string;
        organizationSlug: string;
        organizationId?: undefined;
        outcomeSource?: LeadOutcomeSource;
        sourceSystem?: string | null;
        sourceRecordId?: string | null;
        sourceEventId?: string | null;
      }
    | {
        actorType: "INTEGRATION";
        userId?: undefined;
        organizationSlug?: undefined;
        organizationId: string;
        outcomeSource: "API" | "CSV_IMPORT";
        sourceSystem?: string | null;
        sourceRecordId?: string | null;
        sourceEventId?: string | null;
      }
  );

type PreparedLeadOutcomeMutation = {
  organizationId: string;
  leadId: string;
  mutationId: string;
  expectedVersion: number;
  status?: LeadOutcomeStatus;
  requestedRevenue: RequestedRevenue;
  confirmTerminalTransition: boolean;
  effectiveAt?: Date;
  actorType: LeadOutcomeActorType;
  actorUserId: string | null;
  source: LeadOutcomeSource;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceEventId: string | null;
};

async function requireLeadManage(userId: string, organizationSlug: string) {
  const context = await requireOrganizationMembership(userId, organizationSlug);
  if (!hasOrganizationPermission(context.membership.role, "leads:manage")) {
    throw new AuthorizationError();
  }
  return context;
}

function parseRequestedRevenue(
  input: SharedLeadOutcomeFields,
  revenueSource: LeadOutcomeSource,
): RequestedRevenue {
  if (input.clearRevenue) return { kind: "clear" };
  if (!input.revenue) return { kind: "keep" };
  try {
    const parsed = parseMoney(input.revenue.amount, input.revenue.currency);
    return {
      kind: "set",
      amountMinor: parsed.amountMinor,
      currencyCode: parsed.currencyCode,
      source: revenueSource,
    };
  } catch (error) {
    if (error instanceof MoneyParseError) {
      throw new DomainError(error.message);
    }
    throw error;
  }
}

async function prepareLeadOutcomeMutation(
  input: ApplyLeadOutcomeInput,
): Promise<PreparedLeadOutcomeMutation> {
  if (!MUTATION_ID.test(input.mutationId)) {
    throw new DomainError("mutationId must be a UUID.");
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new DomainError("expectedVersion is invalid.");
  }

  if (input.actorType === "INTEGRATION") {
    const source = input.outcomeSource;
    return {
      organizationId: input.organizationId,
      leadId: input.leadId,
      mutationId: input.mutationId,
      expectedVersion: input.expectedVersion,
      status: input.status,
      requestedRevenue: parseRequestedRevenue(input, source),
      confirmTerminalTransition: true,
      effectiveAt: input.effectiveAt,
      actorType: "INTEGRATION",
      actorUserId: null,
      source,
      sourceSystem: input.sourceSystem ?? null,
      sourceRecordId: input.sourceRecordId ?? null,
      sourceEventId: input.sourceEventId ?? null,
    };
  }

  const context = await requireLeadManage(input.userId, input.organizationSlug);
  const source = input.outcomeSource ?? "MANUAL";
  return {
    organizationId: context.organization.id,
    leadId: input.leadId,
    mutationId: input.mutationId,
    expectedVersion: input.expectedVersion,
    status: input.status,
    requestedRevenue: parseRequestedRevenue(input, source),
    confirmTerminalTransition: Boolean(input.confirmTerminalTransition),
    effectiveAt: input.effectiveAt,
    actorType: "USER",
    actorUserId: input.userId,
    source,
    sourceSystem: input.sourceSystem ?? null,
    sourceRecordId: input.sourceRecordId ?? null,
    sourceEventId: input.sourceEventId ?? null,
  };
}

export type AppliedLeadOutcomeResult = {
  outcome: {
    id: string;
    organizationId: string;
    websiteId: string;
    leadId: string;
    status: LeadOutcomeStatus;
    statusChangedAt: Date;
    qualifiedAt: Date | null;
    wonAt: Date | null;
    lostAt: Date | null;
    revenueAmountMinor: bigint | null;
    revenueCurrencyCode: string | null;
    revenueSource: LeadOutcomeSource | null;
    revenueUpdatedAt: Date | null;
    version: number;
  };
  duplicate: boolean;
  lead: {
    id: string;
    organizationId: string;
    websiteId: string;
    occurredAt: Date;
    attribution: { primaryTouchId: string | null } | null;
  } | null;
  outcomeEventId: string | null;
};

export async function executeLeadOutcomeMutation(
  tx: Prisma.TransactionClient,
  prepared: PreparedLeadOutcomeMutation,
  now = new Date(),
): Promise<AppliedLeadOutcomeResult> {
  const lead = await tx.lead.findFirst({
    where: {
      id: prepared.leadId,
      organizationId: prepared.organizationId,
    },
    include: { outcome: true, attribution: true },
  });
  if (!lead?.outcome) throw new LeadNotFoundError();
  const outcome = lead.outcome;

  const existingEvent = await tx.leadOutcomeEvent.findUnique({
    where: {
      outcomeId_mutationId: {
        outcomeId: outcome.id,
        mutationId: prepared.mutationId,
      },
    },
  });
  if (existingEvent) {
    return {
      outcome,
      duplicate: true,
      lead,
      outcomeEventId: existingEvent.id,
    };
  }

  if (outcome.version !== prepared.expectedVersion) {
    incrementLeadOutcomeMetric("lead_outcome_conflicts_total");
    logger.info("lead.outcome.version_conflict", {
      organizationId: outcome.organizationId,
      websiteId: outcome.websiteId,
      leadId: lead.id,
      outcomeId: outcome.id,
      expectedVersion: prepared.expectedVersion,
      currentVersion: outcome.version,
    });
    throw new OutcomeVersionConflictError();
  }

  const calculated = calculateLeadOutcomeMutation({
    current: toSnapshot(outcome),
    requestedStatus: prepared.status,
    requestedRevenue: prepared.requestedRevenue,
    confirmTerminalTransition: prepared.confirmTerminalTransition,
    effectiveAt: prepared.effectiveAt ?? now,
    now,
    leadOccurredAt: lead.occurredAt,
  });
  if (!calculated.ok) {
    throw new DomainError(calculated.message);
  }
  if (calculated.noop) {
    return {
      outcome,
      duplicate: false,
      lead,
      outcomeEventId: null,
    };
  }

  const updated = await tx.leadOutcome.updateMany({
    where: { id: outcome.id, version: prepared.expectedVersion },
    data: {
      status: calculated.status,
      statusChangedAt: calculated.statusChangedAt,
      qualifiedAt: calculated.qualifiedAt,
      wonAt: calculated.wonAt,
      lostAt: calculated.lostAt,
      revenueAmountMinor: calculated.revenueAmountMinor,
      revenueCurrencyCode: calculated.revenueCurrencyCode,
      revenueSource: calculated.revenueSource,
      revenueUpdatedAt: calculated.revenueUpdatedAt,
      version: calculated.nextVersion,
    },
  });
  if (updated.count !== 1) {
    incrementLeadOutcomeMetric("lead_outcome_conflicts_total");
    throw new OutcomeVersionConflictError();
  }

  const createdEvent = await tx.leadOutcomeEvent.create({
    data: {
      organizationId: outcome.organizationId,
      websiteId: outcome.websiteId,
      leadId: lead.id,
      outcomeId: outcome.id,
      mutationId: prepared.mutationId,
      version: calculated.nextVersion,
      changeType: calculated.changeType,
      beforeStatus: outcome.status,
      afterStatus: calculated.status,
      beforeRevenueAmountMinor: outcome.revenueAmountMinor,
      afterRevenueAmountMinor: calculated.revenueAmountMinor,
      beforeRevenueCurrencyCode: outcome.revenueCurrencyCode,
      afterRevenueCurrencyCode: calculated.revenueCurrencyCode,
      source: prepared.source,
      actorType: prepared.actorType,
      actorUserId: prepared.actorUserId,
      sourceSystem: prepared.sourceSystem,
      sourceRecordId: prepared.sourceRecordId,
      sourceEventId: prepared.sourceEventId,
      effectiveAt: prepared.effectiveAt ?? now,
    },
  });

  const next = await tx.leadOutcome.findUniqueOrThrow({
    where: { id: outcome.id },
  });
  incrementLeadOutcomeMetric("lead_outcome_changes_total");
  if (calculated.changeType !== "REVENUE_CHANGED") {
    logger.info("lead.outcome.changed", {
      organizationId: outcome.organizationId,
      websiteId: outcome.websiteId,
      leadId: lead.id,
      outcomeId: outcome.id,
      fromStatus: outcome.status,
      toStatus: calculated.status,
      actorType: prepared.actorType,
      actorUserId: prepared.actorUserId,
      hasRevenue: calculated.revenueAmountMinor !== null,
      currency: calculated.revenueCurrencyCode,
    });
  }
  if (
    calculated.changeType === "REVENUE_CHANGED" ||
    calculated.changeType === "STATUS_AND_REVENUE_CHANGED"
  ) {
    incrementLeadOutcomeMetric("lead_revenue_updates_total");
    logger.info("lead.revenue.changed", {
      organizationId: outcome.organizationId,
      websiteId: outcome.websiteId,
      leadId: lead.id,
      outcomeId: outcome.id,
      actorType: prepared.actorType,
      actorUserId: prepared.actorUserId,
      hasRevenue: calculated.revenueAmountMinor !== null,
      currency: calculated.revenueCurrencyCode,
    });
  }
  if (outcome.status !== "WON" && calculated.status === "WON") {
    incrementLeadOutcomeMetric("leads_won_total");
  }
  if (outcome.status !== "LOST" && calculated.status === "LOST") {
    incrementLeadOutcomeMetric("leads_lost_total");
  }
  return {
    outcome: next,
    duplicate: false,
    lead,
    outcomeEventId: createdEvent.id,
  };
}

export async function applyLeadOutcomeMutation(input: ApplyLeadOutcomeInput) {
  const prepared = await prepareLeadOutcomeMutation(input);
  try {
    const result = await database.$transaction((tx) =>
      executeLeadOutcomeMutation(tx, prepared),
    );
    if (!result.duplicate && process.env.VITEST !== "true") {
      void enqueueGoogleConversionPlan({
        leadId: result.outcome.leadId,
        organizationId: result.outcome.organizationId,
      }).catch((error: unknown) => {
        logger.warn("google_conversion.plan.enqueue_failed", {
          leadId: result.outcome.leadId,
          organizationId: result.outcome.organizationId,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
    }
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const outcome = await database.leadOutcome.findUnique({
        where: { leadId: input.leadId },
      });
      if (outcome) {
        return {
          outcome,
          duplicate: true as const,
          lead: null,
          outcomeEventId: null,
        };
      }
    }
    throw error;
  }
}

export { prepareLeadOutcomeMutation };

export function newOutcomeMutationId(): string {
  return randomUUID();
}
