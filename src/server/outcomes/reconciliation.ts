import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { requireOrganizationMembership } from "@/server/authorization/organization";
import { ingestParsedOutcomeEvent } from "@/server/outcomes/service";
import { minorUnitsToDecimal } from "@/lib/money";
import { createLogger } from "@/server/logger";

const logger = createLogger("outcome-reconciliation");

async function requireLeadManage(userId: string, organizationSlug: string) {
  const context = await requireOrganizationMembership(userId, organizationSlug);
  if (!hasOrganizationPermission(context.membership.role, "leads:manage")) {
    throw new AuthorizationError();
  }
  return context;
}

export async function ignoreExternalOutcomeEvent(input: {
  userId: string;
  organizationSlug: string;
  eventId: string;
}) {
  const context = await requireLeadManage(input.userId, input.organizationSlug);
  const updated = await database.externalOutcomeEvent.updateMany({
    where: {
      id: input.eventId,
      organizationId: context.organization.id,
      status: { in: ["UNMATCHED", "AMBIGUOUS", "RECEIVED", "CONFLICT"] },
    },
    data: {
      status: "IGNORED",
      processedAt: new Date(),
      errorCode: null,
    },
  });
  if (updated.count !== 1) {
    throw new DomainError("Event cannot be ignored.");
  }
  logger.info("outcome_ingestion.ignored", {
    organizationId: context.organization.id,
    externalEventId: input.eventId,
    actorUserId: input.userId,
  });
}

export async function linkUnmatchedOutcomeEvent(input: {
  userId: string;
  organizationSlug: string;
  eventId: string;
  publicLeadId?: string;
  externalLeadId?: string;
  websiteId?: string;
}) {
  const context = await requireLeadManage(input.userId, input.organizationSlug);
  const event = await database.externalOutcomeEvent.findFirst({
    where: {
      id: input.eventId,
      organizationId: context.organization.id,
    },
    include: { integration: true },
  });
  if (!event) throw new DomainError("Event not found.");
  if (!["UNMATCHED", "AMBIGUOUS", "RECEIVED"].includes(event.status)) {
    throw new DomainError("Only unmatched events can be linked.");
  }
  if (!event.normalizedStatus || !event.effectiveAt) {
    throw new DomainError("Event is missing a normalized status.");
  }
  const allowed = await database.externalOutcomeIntegrationWebsite.findMany({
    where: { integrationId: event.integrationId },
    select: { websiteId: true },
  });
  const websiteIds = allowed.map((row) => row.websiteId);
  const publicLeadId = input.publicLeadId?.trim() || event.publicLeadId;
  const externalLeadId = input.externalLeadId?.trim() || event.externalLeadId;
  let lead = publicLeadId
    ? await database.lead.findFirst({
        where: {
          publicLeadId,
          organizationId: context.organization.id,
          ...(input.websiteId ? { websiteId: input.websiteId } : {}),
        },
      })
    : null;
  if (!lead && externalLeadId) {
    const matches = await database.lead.findMany({
      where: {
        organizationId: context.organization.id,
        externalLeadId,
        websiteId: input.websiteId ? input.websiteId : { in: websiteIds },
      },
    });
    if (matches.length > 1) {
      throw new DomainError("Multiple leads match that external ID.");
    }
    lead = matches[0] ?? null;
  }
  if (!lead) throw new DomainError("Lead not found.");
  if (!websiteIds.includes(lead.websiteId)) {
    throw new DomainError("That lead is outside this integration's websites.");
  }

  const sourceRecordId = event.sourceRecordId;
  if (sourceRecordId) {
    try {
      await database.externalLeadLink.create({
        data: {
          organizationId: context.organization.id,
          integrationId: event.integrationId,
          leadId: lead.id,
          sourceSystem: event.sourceSystem,
          sourceRecordId,
          matchMethod: "MANUAL",
          linkedByUserId: input.userId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await database.externalLeadLink.findUnique({
          where: {
            integrationId_sourceRecordId: {
              integrationId: event.integrationId,
              sourceRecordId,
            },
          },
        });
        if (existing && existing.leadId !== lead.id) {
          throw new DomainError(
            "This source record is already linked to another lead.",
          );
        }
      } else {
        throw error;
      }
    }
  }

  logger.info("outcome_ingestion.linked", {
    organizationId: context.organization.id,
    integrationId: event.integrationId,
    externalEventId: event.id,
    leadId: lead.id,
    actorUserId: input.userId,
  });

  const related = sourceRecordId
    ? await database.externalOutcomeEvent.findMany({
        where: {
          integrationId: event.integrationId,
          sourceRecordId,
          status: { in: ["UNMATCHED", "AMBIGUOUS", "RECEIVED"] },
        },
        orderBy: { effectiveAt: "asc" },
      })
    : [event];

  const results = [];
  for (const item of related) {
    if (!item.normalizedStatus || !item.effectiveAt) continue;
    await database.externalOutcomeEvent.update({
      where: { id: item.id },
      data: { status: "RECEIVED", processedAt: null, errorCode: null },
    });
    const ingested = await ingestParsedOutcomeEvent({
      integration: {
        id: event.integration.id,
        organizationId: event.integration.organizationId,
        name: event.integration.name,
        type: event.integration.type,
        status: event.integration.status,
        authMode: event.integration.authMode,
        sourceSystem: event.integration.sourceSystem,
        credentialPrefix: event.integration.credentialPrefix,
      },
      parsed: {
        eventId: item.sourceEventId,
        externalLeadId: item.externalLeadId ?? lead.externalLeadId,
        publicLeadId: lead.publicLeadId,
        sourceRecordId: item.sourceRecordId,
        sourceVersion: item.sourceVersion,
        status: item.normalizedStatus,
        effectiveAt: item.effectiveAt,
        revenueAmount:
          item.revenueAmountMinor !== null && item.revenueCurrencyCode
            ? minorUnitsToDecimal(
                item.revenueAmountMinor,
                item.revenueCurrencyCode,
              )
            : null,
        revenueCurrency: item.revenueCurrencyCode,
      },
      persist: true,
      outcomeSource: "API",
    });
    results.push(ingested);
  }
  return { leadId: lead.id, results };
}
