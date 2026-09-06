import "server-only";

import { database } from "@/server/database";
import { maskOutcomeCredential } from "@/server/outcomes/credentials";
import { getServerEnvironment } from "@/lib/env";

export async function listOutcomeIntegrations(organizationId: string) {
  const integrations = await database.externalOutcomeIntegration.findMany({
    where: { organizationId },
    include: {
      websites: { include: { website: { select: { id: true, name: true } } } },
      _count: {
        select: {
          events: { where: { status: { in: ["UNMATCHED", "AMBIGUOUS"] } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return integrations.map((item) => {
    const unmatched = item._count.events;
    const attention =
      item.status === "DISABLED"
        ? "Disabled"
        : unmatched > 0
          ? "Needs attention"
          : "Healthy";
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      status: item.status,
      authMode: item.authMode,
      sourceSystem: item.sourceSystem,
      maskedCredential: maskOutcomeCredential(item.credentialPrefix),
      websites: item.websites.map((row) => row.website),
      unmatchedCount: unmatched,
      attention,
      lastEventReceivedAt: item.lastEventReceivedAt,
      lastAppliedAt: item.lastAppliedAt,
    };
  });
}

export async function getOutcomeIntegrationDetail(
  organizationId: string,
  integrationId: string,
) {
  const integration = await database.externalOutcomeIntegration.findFirst({
    where: { id: integrationId, organizationId },
    include: {
      websites: { include: { website: { select: { id: true, name: true } } } },
    },
  });
  if (!integration) return null;
  const counts = await database.externalOutcomeEvent.groupBy({
    by: ["status"],
    where: { integrationId, organizationId },
    _count: { _all: true },
  });
  const countMap = Object.fromEntries(
    counts.map((row) => [row.status, row._count._all]),
  );
  const baseUrl = getServerEnvironment().APP_URL.replace(/\/$/, "");
  return {
    id: integration.id,
    name: integration.name,
    type: integration.type,
    status: integration.status,
    authMode: integration.authMode,
    sourceSystem: integration.sourceSystem,
    maskedCredential: maskOutcomeCredential(integration.credentialPrefix),
    websites: integration.websites.map((row) => row.website),
    counts: countMap,
    lastEventReceivedAt: integration.lastEventReceivedAt,
    lastAppliedAt: integration.lastAppliedAt,
    endpoints: {
      events: `${baseUrl}/api/outcomes/v1/events`,
      batch: `${baseUrl}/api/outcomes/v1/events/batch`,
      validate: `${baseUrl}/api/outcomes/v1/validate`,
    },
  };
}

export async function listUnmatchedOutcomeEvents(
  organizationId: string,
  take = 50,
) {
  return database.externalOutcomeEvent.findMany({
    where: {
      organizationId,
      status: { in: ["UNMATCHED", "AMBIGUOUS"] },
    },
    include: {
      integration: { select: { id: true, name: true, sourceSystem: true } },
    },
    orderBy: { receivedAt: "desc" },
    take,
  });
}

export async function listOutcomeEvents(
  organizationId: string,
  integrationId?: string,
  take = 50,
) {
  return database.externalOutcomeEvent.findMany({
    where: {
      organizationId,
      ...(integrationId ? { integrationId } : {}),
    },
    include: {
      integration: { select: { id: true, name: true, sourceSystem: true } },
    },
    orderBy: { receivedAt: "desc" },
    take,
  });
}

export async function listOutcomeImports(organizationId: string, take = 30) {
  return database.outcomeImport.findMany({
    where: { organizationId },
    include: {
      integration: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function unmatchedOutcomeCount(organizationId: string) {
  return database.externalOutcomeEvent.count({
    where: {
      organizationId,
      status: { in: ["UNMATCHED", "AMBIGUOUS"] },
    },
  });
}
