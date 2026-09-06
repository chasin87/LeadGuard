import "server-only";

import { database } from "@/server/database";
import { decryptSecret } from "@/server/google-ads/encryption";
import {
  hashOutcomeSecret,
  isOutcomeIntegrationCredential,
  outcomeSecretsMatch,
} from "@/server/outcomes/credentials";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";
import {
  signWebhookBody,
  webhookSignaturesMatch,
} from "@/server/notifications/webhooks/signature";
import type {
  ExternalOutcomeAuthMode,
  ExternalOutcomeIntegrationStatus,
  ExternalOutcomeIntegrationType,
} from "@/generated/prisma/enums";

export type AuthenticatedOutcomeIntegration = {
  id: string;
  organizationId: string;
  name: string;
  type: ExternalOutcomeIntegrationType;
  status: ExternalOutcomeIntegrationStatus;
  authMode: ExternalOutcomeAuthMode;
  sourceSystem: string;
  credentialPrefix: string;
};

export type OutcomeAuthFailure =
  | "INVALID_CREDENTIAL"
  | "INTEGRATION_DISABLED"
  | "INVALID_SIGNATURE"
  | "EXPIRED_TIMESTAMP"
  | "AUTH_MODE_MISMATCH";

function withinHmacWindow(timestampHeader: string, now: Date): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  return (
    Math.abs(now.getTime() - tsMs) <= getOutcomeIngestionConfig().hmacWindowMs
  );
}

function toAuthenticated(integration: {
  id: string;
  organizationId: string;
  name: string;
  type: ExternalOutcomeIntegrationType;
  status: ExternalOutcomeIntegrationStatus;
  authMode: ExternalOutcomeAuthMode;
  sourceSystem: string;
  credentialPrefix: string;
}): AuthenticatedOutcomeIntegration {
  return {
    id: integration.id,
    organizationId: integration.organizationId,
    name: integration.name,
    type: integration.type,
    status: integration.status,
    authMode: integration.authMode,
    sourceSystem: integration.sourceSystem,
    credentialPrefix: integration.credentialPrefix,
  };
}

export async function authenticateOutcomeBearer(
  authorizationHeader: string | null,
  now = new Date(),
): Promise<
  | { ok: true; integration: AuthenticatedOutcomeIntegration }
  | { ok: false; code: OutcomeAuthFailure }
> {
  const token = authorizationHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || !isOutcomeIntegrationCredential(token)) {
    return { ok: false, code: "INVALID_CREDENTIAL" };
  }
  const hash = hashOutcomeSecret(token);
  const integration = await database.externalOutcomeIntegration.findFirst({
    where: {
      OR: [
        { credentialHash: hash },
        {
          previousCredentialHash: hash,
          previousCredentialExpiresAt: { gt: now },
        },
      ],
    },
  });
  if (!integration) return { ok: false, code: "INVALID_CREDENTIAL" };
  if (integration.status !== "ENABLED") {
    return { ok: false, code: "INTEGRATION_DISABLED" };
  }
  if (integration.authMode !== "BEARER") {
    return { ok: false, code: "AUTH_MODE_MISMATCH" };
  }
  return { ok: true, integration: toAuthenticated(integration) };
}

export async function authenticateOutcomeHmac(input: {
  integrationId: string | null;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  now?: Date;
}): Promise<
  | { ok: true; integration: AuthenticatedOutcomeIntegration }
  | { ok: false; code: OutcomeAuthFailure }
> {
  const now = input.now ?? new Date();
  if (!input.integrationId) return { ok: false, code: "INVALID_CREDENTIAL" };
  const integration = await database.externalOutcomeIntegration.findUnique({
    where: { id: input.integrationId },
  });
  if (!integration?.signingSecretCiphertext || !integration.signingSecretHash) {
    return { ok: false, code: "INVALID_CREDENTIAL" };
  }
  if (integration.status !== "ENABLED") {
    return { ok: false, code: "INTEGRATION_DISABLED" };
  }
  if (integration.authMode !== "HMAC") {
    return { ok: false, code: "AUTH_MODE_MISMATCH" };
  }
  const timestamp = input.timestampHeader ?? "";
  const signature = input.signatureHeader ?? "";
  if (!timestamp || !signature) {
    return { ok: false, code: "INVALID_SIGNATURE" };
  }
  if (!withinHmacWindow(timestamp, now)) {
    return { ok: false, code: "EXPIRED_TIMESTAMP" };
  }
  let signingSecret: string;
  try {
    signingSecret = decryptSecret(integration.signingSecretCiphertext);
  } catch {
    return { ok: false, code: "INVALID_CREDENTIAL" };
  }
  if (
    !outcomeSecretsMatch(
      hashOutcomeSecret(signingSecret),
      integration.signingSecretHash,
    )
  ) {
    return { ok: false, code: "INVALID_CREDENTIAL" };
  }
  const expected = signWebhookBody(signingSecret, timestamp, input.rawBody);
  if (!webhookSignaturesMatch(signature, expected)) {
    return { ok: false, code: "INVALID_SIGNATURE" };
  }
  return { ok: true, integration: toAuthenticated(integration) };
}

export async function authenticateOutcomeRequest(input: {
  authorizationHeader: string | null;
  integrationIdHeader: string | null;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  now?: Date;
}): Promise<
  | { ok: true; integration: AuthenticatedOutcomeIntegration }
  | { ok: false; code: OutcomeAuthFailure }
> {
  if (input.signatureHeader || input.timestampHeader) {
    return authenticateOutcomeHmac({
      integrationId: input.integrationIdHeader?.trim() || null,
      timestampHeader: input.timestampHeader,
      signatureHeader: input.signatureHeader,
      rawBody: input.rawBody,
      now: input.now,
    });
  }
  return authenticateOutcomeBearer(input.authorizationHeader, input.now);
}
