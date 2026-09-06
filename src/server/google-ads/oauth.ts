import { createHash } from "node:crypto";
import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";
import { getGoogleAdsConfig } from "@/server/google-ads/config";
import {
  generateOAuthState,
  getGoogleAdsAuthClient,
  hashOAuthState,
} from "@/server/google-ads/clients";
import { encryptSecret } from "@/server/google-ads/encryption";
import { googleAdsUserErrors } from "@/server/google-ads/errors";
import {
  hasScope,
  joinScopes,
  parseGrantedScopes,
  requestedScopesForIntent,
  type GoogleOAuthIntent,
} from "@/server/google-ads/scopes";
import { googleDataManagerOAuthScope } from "@/server/google-data-manager/config";

const logger = createLogger("google-ads");

export async function startGoogleAdsOAuth(input: {
  userId: string;
  organizationSlug: string;
  intent?: GoogleOAuthIntent;
}): Promise<string> {
  const access = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "integrations:manage",
  );
  const config = getGoogleAdsConfig();
  if (
    config.provider === "google" &&
    (!config.clientId || !config.clientSecret)
  ) {
    throw new DomainError(googleAdsUserErrors.platformConfig);
  }

  const intent: GoogleOAuthIntent = input.intent ?? "connect";
  const scopes = requestedScopesForIntent(intent);
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + config.oauthStateTtlSeconds * 1000);
  await database.googleAdsOAuthState.create({
    data: {
      stateHash: hashOAuthState(state),
      organizationId: access.organization.id,
      userId: input.userId,
      intent,
      requestedScopes: joinScopes(scopes),
      expiresAt,
    },
  });
  logger.info("google_ads.oauth.started", {
    organizationId: access.organization.id,
    userId: input.userId,
    intent,
  });
  return getGoogleAdsAuthClient().createAuthorizationUrl({
    state,
    redirectUri: config.redirectUri,
    clientId: config.clientId || "fake-client-id",
    scopes,
    includeGrantedScopes: intent === "data_manager",
    intent,
  });
}

export async function consumeGoogleAdsOAuthState(input: {
  state: string;
  userId: string;
}) {
  const stateHash = hashOAuthState(input.state);
  const record = await database.googleAdsOAuthState.findUnique({
    where: { stateHash },
  });
  if (!record) {
    throw new DomainError("This Google Ads connection request is invalid.");
  }
  if (record.consumedAt) {
    throw new DomainError(
      "This Google Ads connection request was already used.",
    );
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new DomainError("This Google Ads connection request has expired.");
  }
  if (record.userId !== input.userId) {
    throw new DomainError(
      "This Google Ads connection request belongs to another user.",
    );
  }

  const updated = await database.googleAdsOAuthState.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (updated.count !== 1) {
    throw new DomainError(
      "This Google Ads connection request was already used.",
    );
  }

  return record;
}

export async function completeGoogleAdsOAuth(input: {
  userId: string;
  code: string;
  state: string;
}): Promise<{ organizationSlug: string }> {
  const pending = await consumeGoogleAdsOAuthState({
    state: input.state,
    userId: input.userId,
  });
  const access = await requireOrganizationRole(
    input.userId,
    (
      await database.organization.findUniqueOrThrow({
        where: { id: pending.organizationId },
        select: { slug: true },
      })
    ).slug,
    "integrations:manage",
  );
  if (access.organization.id !== pending.organizationId) {
    throw new DomainError("This Google Ads connection request is invalid.");
  }

  const config = getGoogleAdsConfig();
  const tokens = await getGoogleAdsAuthClient().exchangeAuthorizationCode({
    code: input.code,
    redirectUri: config.redirectUri,
    clientId: config.clientId || "fake-client-id",
    clientSecret: config.clientSecret || "fake-client-secret",
  });
  if (!tokens.refreshToken) {
    throw new DomainError(googleAdsUserErrors.missingOfflineAccess);
  }

  const grantedScopes = tokens.scope ?? pending.requestedScopes;
  const granted = parseGrantedScopes(grantedScopes);
  const hasDataManager = hasScope(granted, googleDataManagerOAuthScope);
  const encrypted = encryptSecret(tokens.refreshToken);
  const existing = await database.googleAdsConnection.findUnique({
    where: { organizationId: access.organization.id },
  });
  const dataManagerStatus = hasDataManager
    ? "READY"
    : existing?.dataManagerStatus === "READY" ||
        pending.intent === "data_manager"
      ? "REAUTH_REQUIRED"
      : "NOT_CONFIGURED";
  const connection = existing
    ? await database.googleAdsConnection.update({
        where: { id: existing.id },
        data: {
          status: "CONNECTED",
          encryptedRefreshToken: encrypted.ciphertext,
          credentialVersion: encrypted.version,
          googleAccountEmail: tokens.email,
          grantedScopes,
          dataManagerStatus,
          lastSyncErrorCode: null,
        },
      })
    : await database.googleAdsConnection.create({
        data: {
          organizationId: access.organization.id,
          status: "CONNECTED",
          encryptedRefreshToken: encrypted.ciphertext,
          credentialVersion: encrypted.version,
          googleAccountEmail: tokens.email,
          grantedScopes,
          dataManagerStatus,
        },
      });

  if (existing && dataManagerStatus !== "READY") {
    await database.googleAdsConversionFeedbackConfig.updateMany({
      where: {
        googleAdsConnectionId: connection.id,
        status: { in: ["ACTIVE", "READY"] },
      },
      data: { status: "NEEDS_REAUTH" },
    });
  }

  logger.info("google_ads.connected", {
    organizationId: access.organization.id,
    connectionId: connection.id,
    userId: input.userId,
    reconnect: Boolean(existing),
    intent: pending.intent,
    dataManagerReady: dataManagerStatus === "READY",
  });
  return { organizationSlug: access.organization.slug };
}

export function oauthStateFingerprint(state: string): string {
  return createHash("sha256").update(state).digest("hex").slice(0, 12);
}
