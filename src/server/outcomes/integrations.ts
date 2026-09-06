import "server-only";

import { addMinutes } from "@/server/outcomes/time";
import { database } from "@/server/database";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { requireOrganizationMembership } from "@/server/authorization/organization";
import { encryptSecret } from "@/server/google-ads/encryption";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";
import {
  generateOutcomeIntegrationCredential,
  generateOutcomeSigningSecret,
  hashOutcomeSecret,
  maskOutcomeCredential,
  outcomeCredentialPrefix,
} from "@/server/outcomes/credentials";
import { requireCapacity, requireFeature } from "@/server/billing/limits";
import { isAllowedSourceSystem } from "@/server/outcomes/normalize";
import type {
  ExternalOutcomeAuthMode,
  ExternalOutcomeIntegrationType,
} from "@/generated/prisma/enums";

async function requireIntegrationManage(
  userId: string,
  organizationSlug: string,
) {
  const context = await requireOrganizationMembership(userId, organizationSlug);
  if (
    !hasOrganizationPermission(context.membership.role, "integrations:manage")
  ) {
    throw new AuthorizationError();
  }
  return context;
}

export async function createOutcomeIntegration(input: {
  userId: string;
  organizationSlug: string;
  name: string;
  type: ExternalOutcomeIntegrationType;
  authMode: ExternalOutcomeAuthMode;
  sourceSystem: string;
  websiteIds: string[];
}) {
  const context = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new DomainError("Integration name must be 2–80 characters.");
  }
  const sourceSystem = input.sourceSystem.trim().toLowerCase();
  if (!isAllowedSourceSystem(sourceSystem)) {
    throw new DomainError(
      "Source system must be a lowercase slug (letters, numbers, dashes).",
    );
  }
  if (input.websiteIds.length < 1) {
    throw new DomainError("Select at least one website to match against.");
  }
  const websites = await database.website.findMany({
    where: {
      id: { in: input.websiteIds },
      organizationId: context.organization.id,
    },
    select: { id: true },
  });
  if (websites.length !== input.websiteIds.length) {
    throw new DomainError("One or more websites are not in this organization.");
  }
  const credential = generateOutcomeIntegrationCredential();
  const signingSecret =
    input.authMode === "HMAC" ? generateOutcomeSigningSecret() : null;
  await requireFeature(
    context.organization.id,
    input.type === "API" || input.type === "WEBHOOK"
      ? "apiOutcomeIngestion"
      : "csvImports",
  );
  const created = await database.$transaction(async (tx) => {
    await requireCapacity(
      context.organization.id,
      "outcomeIntegrations",
      1,
      tx,
    );
    return tx.externalOutcomeIntegration.create({
      data: {
        organizationId: context.organization.id,
        name,
        type: input.type,
        authMode: input.authMode,
        sourceSystem,
        credentialHash: hashOutcomeSecret(credential),
        credentialPrefix: outcomeCredentialPrefix(credential),
        signingSecretHash: signingSecret
          ? hashOutcomeSecret(signingSecret)
          : null,
        signingSecretCiphertext: signingSecret
          ? encryptSecret(signingSecret).ciphertext
          : null,
        websites: {
          create: websites.map((website) => ({
            websiteId: website.id,
            organizationId: context.organization.id,
          })),
        },
      },
    });
  });
  return {
    integration: created,
    credential,
    signingSecret,
    maskedCredential: maskOutcomeCredential(created.credentialPrefix),
  };
}

export async function rotateOutcomeIntegrationCredential(input: {
  userId: string;
  organizationSlug: string;
  integrationId: string;
}) {
  const context = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const integration = await database.externalOutcomeIntegration.findFirst({
    where: {
      id: input.integrationId,
      organizationId: context.organization.id,
    },
  });
  if (!integration) throw new DomainError("Integration not found.");
  const credential = generateOutcomeIntegrationCredential();
  const grace = getOutcomeIngestionConfig().credentialRotationGraceMinutes;
  const updated = await database.externalOutcomeIntegration.update({
    where: { id: integration.id },
    data: {
      previousCredentialHash: integration.credentialHash,
      previousCredentialExpiresAt: addMinutes(new Date(), grace),
      credentialHash: hashOutcomeSecret(credential),
      credentialPrefix: outcomeCredentialPrefix(credential),
    },
  });
  return {
    credential,
    maskedCredential: maskOutcomeCredential(updated.credentialPrefix),
    previousExpiresAt: updated.previousCredentialExpiresAt,
  };
}

export async function rotateOutcomeSigningSecret(input: {
  userId: string;
  organizationSlug: string;
  integrationId: string;
}) {
  const context = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const integration = await database.externalOutcomeIntegration.findFirst({
    where: {
      id: input.integrationId,
      organizationId: context.organization.id,
    },
  });
  if (!integration) throw new DomainError("Integration not found.");
  if (integration.authMode !== "HMAC") {
    throw new DomainError("This integration does not use HMAC.");
  }
  const signingSecret = generateOutcomeSigningSecret();
  await database.externalOutcomeIntegration.update({
    where: { id: integration.id },
    data: {
      signingSecretHash: hashOutcomeSecret(signingSecret),
      signingSecretCiphertext: encryptSecret(signingSecret).ciphertext,
    },
  });
  return { signingSecret };
}

export async function setOutcomeIntegrationStatus(input: {
  userId: string;
  organizationSlug: string;
  integrationId: string;
  status: "ENABLED" | "DISABLED";
}) {
  const context = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  const updated = await database.externalOutcomeIntegration.updateMany({
    where: {
      id: input.integrationId,
      organizationId: context.organization.id,
    },
    data: { status: input.status },
  });
  if (updated.count !== 1) throw new DomainError("Integration not found.");
}

export async function updateOutcomeIntegrationWebsites(input: {
  userId: string;
  organizationSlug: string;
  integrationId: string;
  websiteIds: string[];
}) {
  const context = await requireIntegrationManage(
    input.userId,
    input.organizationSlug,
  );
  if (input.websiteIds.length < 1) {
    throw new DomainError("Select at least one website to match against.");
  }
  const integration = await database.externalOutcomeIntegration.findFirst({
    where: {
      id: input.integrationId,
      organizationId: context.organization.id,
    },
  });
  if (!integration) throw new DomainError("Integration not found.");
  const websites = await database.website.findMany({
    where: {
      id: { in: input.websiteIds },
      organizationId: context.organization.id,
    },
    select: { id: true },
  });
  if (websites.length !== input.websiteIds.length) {
    throw new DomainError("One or more websites are not in this organization.");
  }
  await database.$transaction(async (tx) => {
    await tx.externalOutcomeIntegrationWebsite.deleteMany({
      where: { integrationId: integration.id },
    });
    await tx.externalOutcomeIntegrationWebsite.createMany({
      data: websites.map((website) => ({
        integrationId: integration.id,
        websiteId: website.id,
        organizationId: context.organization.id,
      })),
    });
  });
}
