import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { incrementTrackingMetric } from "@/server/tracking/metrics";
import {
  clickIdPresence,
  hasAnyClickId,
  parseClickId,
  type GoogleClickIds,
} from "@/lib/tracking/click-ids";
import {
  parseUtmFromUnknown,
  sanitizeLandingUrl,
  sanitizePathname,
  sanitizeReferrerDomain,
} from "@/lib/tracking/landing";
import { getTrackingConfig } from "@/server/tracking/config";
import { encryptClickId, hashClickId } from "@/server/tracking/click-crypto";
import {
  generateAttributionToken,
  generatePublicLeadId,
  generatePublicSiteKey,
  generateServerIngestionSecret,
  hashTrackingSecret,
  isAttributionToken,
  isPublicSiteKey,
  isServerIngestionSecret,
} from "@/server/tracking/keys";
import {
  originsMatchWebsite,
  parseOriginHeader,
} from "@/server/tracking/origin";
import {
  resolveLeadAttribution,
  type AttributionTouchSnapshot,
} from "@/server/tracking/resolver";
import { createInitialLeadOutcome } from "@/server/leads/service";
import { enqueueGoogleAdsClickResolution } from "@/jobs/queue";
import { ensureLeadClickResolution } from "@/server/google-ads/click-resolution";

const logger = createLogger("tracking");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

type TrackingConfigRow = Prisma.WebsiteTrackingConfigGetPayload<{
  include: { website: true };
}>;

export async function findConfigBySiteKey(siteKey: string) {
  if (!isPublicSiteKey(siteKey)) return null;
  const hash = hashTrackingSecret(siteKey);
  return database.websiteTrackingConfig.findFirst({
    where: {
      OR: [
        { publicSiteKeyHash: hash },
        {
          previousPublicSiteKeyHash: hash,
          previousSiteKeyExpiresAt: { gt: new Date() },
        },
      ],
    },
    include: { website: true },
  });
}

export async function findConfigByServerSecret(secret: string) {
  if (!isServerIngestionSecret(secret)) return null;
  const hash = hashTrackingSecret(secret);
  return database.websiteTrackingConfig.findFirst({
    where: { serverIngestionSecretHash: hash },
    include: { website: true },
  });
}

export async function enableWebsiteTracking(input: {
  organizationId: string;
  websiteId: string;
}) {
  const config = getTrackingConfig();
  const existing = await database.websiteTrackingConfig.findUnique({
    where: { websiteId: input.websiteId },
  });
  const siteKey = generatePublicSiteKey();
  const serverSecret = generateServerIngestionSecret();
  const row = existing
    ? await database.websiteTrackingConfig.update({
        where: { id: existing.id },
        data: {
          status: "ENABLED",
          publicSiteKey: siteKey,
          publicSiteKeyHash: hashTrackingSecret(siteKey),
          previousPublicSiteKeyHash: existing.publicSiteKeyHash,
          previousSiteKeyExpiresAt: addMinutes(
            new Date(),
            config.siteKeyRotationGraceMinutes,
          ),
          serverIngestionSecretHash: hashTrackingSecret(serverSecret),
          consentMode: "REQUIRED",
          attributionWindowDays: config.defaultAttributionWindowDays,
          sessionTimeoutMinutes: config.defaultSessionTimeoutMinutes,
        },
      })
    : await database.websiteTrackingConfig.create({
        data: {
          organizationId: input.organizationId,
          websiteId: input.websiteId,
          status: "ENABLED",
          publicSiteKey: siteKey,
          publicSiteKeyHash: hashTrackingSecret(siteKey),
          serverIngestionSecretHash: hashTrackingSecret(serverSecret),
          consentMode: "REQUIRED",
          attributionWindowDays: config.defaultAttributionWindowDays,
          sessionTimeoutMinutes: config.defaultSessionTimeoutMinutes,
        },
      });
  logger.info("tracking.site.enabled", {
    organizationId: input.organizationId,
    websiteId: input.websiteId,
    configId: row.id,
  });
  return { config: row, siteKey, serverSecret };
}

export async function disableWebsiteTracking(websiteId: string) {
  const existing = await database.websiteTrackingConfig.findUnique({
    where: { websiteId },
  });
  if (!existing) return null;
  const updated = await database.websiteTrackingConfig.update({
    where: { id: existing.id },
    data: { status: "DISABLED" },
  });
  logger.info("tracking.site.disabled", {
    organizationId: existing.organizationId,
    websiteId,
  });
  return updated;
}

export async function rotatePublicSiteKey(websiteId: string) {
  const existing = await database.websiteTrackingConfig.findUniqueOrThrow({
    where: { websiteId },
  });
  const siteKey = generatePublicSiteKey();
  const config = getTrackingConfig();
  await database.websiteTrackingConfig.update({
    where: { id: existing.id },
    data: {
      publicSiteKey: siteKey,
      publicSiteKeyHash: hashTrackingSecret(siteKey),
      previousPublicSiteKeyHash: existing.publicSiteKeyHash,
      previousSiteKeyExpiresAt: addMinutes(
        new Date(),
        config.siteKeyRotationGraceMinutes,
      ),
    },
  });
  logger.info("tracking.site_key.rotated", {
    organizationId: existing.organizationId,
    websiteId,
  });
  return siteKey;
}

export async function rotateServerIngestionSecret(websiteId: string) {
  const existing = await database.websiteTrackingConfig.findUniqueOrThrow({
    where: { websiteId },
  });
  const secret = generateServerIngestionSecret();
  await database.websiteTrackingConfig.update({
    where: { id: existing.id },
    data: { serverIngestionSecretHash: hashTrackingSecret(secret) },
  });
  logger.info("tracking.server_secret.rotated", {
    organizationId: existing.organizationId,
    websiteId,
  });
  return secret;
}

function clickFields(ids: GoogleClickIds) {
  const presence = clickIdPresence(ids);
  return {
    encryptedGclid: ids.gclid ? encryptClickId(ids.gclid) : null,
    encryptedGbraid: ids.gbraid ? encryptClickId(ids.gbraid) : null,
    encryptedWbraid: ids.wbraid ? encryptClickId(ids.wbraid) : null,
    gclidHash: ids.gclid ? hashClickId(ids.gclid) : null,
    gbraidHash: ids.gbraid ? hashClickId(ids.gbraid) : null,
    wbraidHash: ids.wbraid ? hashClickId(ids.wbraid) : null,
    hasGclid: presence.hasGclid,
    hasGbraid: presence.hasGbraid,
    hasWbraid: presence.hasWbraid,
    channel: hasAnyClickId(ids) ? ("GOOGLE_ADS" as const) : ("DIRECT" as const),
  };
}

async function upsertVisitorSession(input: {
  config: TrackingConfigRow;
  visitorId: string;
  sessionId: string;
  landingOrigin: string | null;
  landingPath: string | null;
  referrerDomain: string | null;
  now: Date;
}) {
  const expiresAt = addDays(input.now, input.config.attributionWindowDays);
  const visitor = await database.attributionVisitor.upsert({
    where: {
      websiteId_publicVisitorId: {
        websiteId: input.config.websiteId,
        publicVisitorId: input.visitorId,
      },
    },
    update: { lastSeenAt: input.now, expiresAt },
    create: {
      organizationId: input.config.organizationId,
      websiteId: input.config.websiteId,
      publicVisitorId: input.visitorId,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      expiresAt,
    },
  });
  const session = await database.attributionSession.upsert({
    where: {
      websiteId_publicSessionId: {
        websiteId: input.config.websiteId,
        publicSessionId: input.sessionId,
      },
    },
    update: {
      lastSeenAt: input.now,
      ...(input.landingOrigin ? { landingOrigin: input.landingOrigin } : {}),
      ...(input.landingPath ? { landingPath: input.landingPath } : {}),
      ...(input.referrerDomain ? { referrerDomain: input.referrerDomain } : {}),
    },
    create: {
      organizationId: input.config.organizationId,
      websiteId: input.config.websiteId,
      visitorId: visitor.id,
      publicSessionId: input.sessionId,
      startedAt: input.now,
      lastSeenAt: input.now,
      landingOrigin: input.landingOrigin,
      landingPath: input.landingPath,
      referrerDomain: input.referrerDomain,
    },
  });
  if (session.visitorId !== visitor.id) {
    throw new Error("SESSION_VISITOR_MISMATCH");
  }
  return { visitor, session };
}

async function captureTouch(input: {
  config: TrackingConfigRow;
  visitorId: string;
  sessionId: string;
  ids: GoogleClickIds;
  landingOrigin: string | null;
  landingPath: string | null;
  utm: ReturnType<typeof parseUtmFromUnknown>;
  now: Date;
}) {
  if (!hasAnyClickId(input.ids)) return null;
  const fields = clickFields(input.ids);
  const latest = await database.attributionTouch.findFirst({
    where: { visitorId: input.visitorId },
    orderBy: { capturedAt: "desc" },
  });
  if (
    latest &&
    latest.gclidHash === fields.gclidHash &&
    latest.gbraidHash === fields.gbraidHash &&
    latest.wbraidHash === fields.wbraidHash
  ) {
    return latest;
  }
  const touch = await database.attributionTouch.create({
    data: {
      organizationId: input.config.organizationId,
      websiteId: input.config.websiteId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      capturedAt: input.now,
      expiresAt: addDays(input.now, input.config.attributionWindowDays),
      landingOrigin: input.landingOrigin,
      landingPath: input.landingPath,
      utmSource: input.utm.utmSource,
      utmMedium: input.utm.utmMedium,
      utmCampaign: input.utm.utmCampaign,
      utmContent: input.utm.utmContent,
      utmTerm: input.utm.utmTerm,
      ...fields,
    },
  });
  incrementTrackingMetric("attribution_touches_created");
  logger.info("tracking.attribution.created", {
    organizationId: input.config.organizationId,
    websiteId: input.config.websiteId,
    touchId: touch.id,
    hasGclid: fields.hasGclid,
    hasGbraid: fields.hasGbraid,
    hasWbraid: fields.hasWbraid,
  });
  return touch;
}

async function issueToken(input: {
  config: TrackingConfigRow;
  visitorId: string;
  sessionId: string;
  now: Date;
}) {
  const existing = await database.attributionToken.findFirst({
    where: {
      sessionId: input.sessionId,
      expiresAt: { gt: input.now },
    },
    orderBy: { issuedAt: "desc" },
  });
  if (existing) {
    await database.attributionToken.update({
      where: { id: existing.id },
      data: { lastUsedAt: input.now },
    });
    return null;
  }
  const token = generateAttributionToken();
  await database.attributionToken.create({
    data: {
      organizationId: input.config.organizationId,
      websiteId: input.config.websiteId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      tokenHash: hashTrackingSecret(token),
      issuedAt: input.now,
      expiresAt: addDays(input.now, input.config.attributionWindowDays),
      lastUsedAt: input.now,
    },
  });
  return token;
}

async function loadToken(token: string) {
  if (!isAttributionToken(token)) return null;
  return database.attributionToken.findUnique({
    where: { tokenHash: hashTrackingSecret(token) },
    include: { session: true, visitor: true },
  });
}

function snapshotsFromTouches(
  touches: Array<{
    id: string;
    capturedAt: Date;
    expiresAt: Date;
    hasGclid: boolean;
    hasGbraid: boolean;
    hasWbraid: boolean;
    channel: AttributionTouchSnapshot["channel"];
  }>,
): AttributionTouchSnapshot[] {
  return touches;
}

async function attributeAndCreateLead(input: {
  config: TrackingConfigRow;
  source: "BROWSER_SDK" | "SERVER_API";
  eventId: string;
  externalLeadId: string | null;
  visitorId: string | null;
  sessionId: string | null;
  occurredAt: Date;
  now: Date;
}) {
  const existingByEvent = await database.lead.findUnique({
    where: {
      websiteId_eventId: {
        websiteId: input.config.websiteId,
        eventId: input.eventId,
      },
    },
    include: { attribution: true },
  });
  if (existingByEvent) return { lead: existingByEvent, duplicate: true };
  if (input.externalLeadId) {
    const existingExternal = await database.lead.findFirst({
      where: {
        websiteId: input.config.websiteId,
        source: input.source,
        externalLeadId: input.externalLeadId,
      },
      include: { attribution: true },
    });
    if (existingExternal) return { lead: existingExternal, duplicate: true };
  }

  const touches = input.visitorId
    ? await database.attributionTouch.findMany({
        where: { visitorId: input.visitorId },
        orderBy: { capturedAt: "asc" },
      })
    : [];
  const resolved = resolveLeadAttribution({
    leadOccurredAt: input.occurredAt,
    now: input.now,
    touches: snapshotsFromTouches(touches),
  });

  const lead = await database.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        organizationId: input.config.organizationId,
        websiteId: input.config.websiteId,
        publicLeadId: generatePublicLeadId(),
        source: input.source,
        occurredAt: input.occurredAt,
        receivedAt: input.now,
        eventId: input.eventId,
        externalLeadId: input.externalLeadId,
        visitorId: input.visitorId,
        sessionId: input.sessionId,
      },
    });
    await tx.leadAttribution.create({
      data: {
        leadId: created.id,
        organizationId: input.config.organizationId,
        websiteId: input.config.websiteId,
        visitorId: input.visitorId,
        sessionId: input.sessionId,
        firstTouchId: resolved.firstTouchId,
        primaryTouchId: resolved.primaryTouchId,
        attributionModel: "LAST_ELIGIBLE_PAID_TOUCH",
        attributionStatus: resolved.attributionStatus,
        finalizedAt: input.now,
      },
    });
    await createInitialLeadOutcome(tx, {
      organizationId: input.config.organizationId,
      websiteId: input.config.websiteId,
      leadId: created.id,
      occurredAt: input.occurredAt,
      now: input.now,
    });
    return created;
  });
  incrementTrackingMetric("leads_created");
  logger.info("tracking.lead.created", {
    organizationId: input.config.organizationId,
    websiteId: input.config.websiteId,
    leadId: lead.id,
    attributed: resolved.attributionStatus === "ATTRIBUTED",
  });
  if (resolved.attributionStatus === "ATTRIBUTED") {
    incrementTrackingMetric("leads_attributed");
    logger.info("tracking.lead.attributed", {
      organizationId: input.config.organizationId,
      websiteId: input.config.websiteId,
      leadId: lead.id,
    });
    if (process.env.VITEST !== "true") {
      const resolution = await ensureLeadClickResolution({
        leadId: lead.id,
        organizationId: input.config.organizationId,
      });
      if (resolution) {
        await enqueueGoogleAdsClickResolution({
          organizationId: input.config.organizationId,
          googleAdsCustomerId: resolution.googleAdsCustomerId,
          leadId: lead.id,
        });
      }
    }
  } else {
    incrementTrackingMetric("leads_unattributed");
  }
  await database.websiteTrackingConfig.update({
    where: { id: input.config.id },
    data: { lastLeadReceivedAt: input.now },
  });
  return { lead, duplicate: false };
}

export type BrowserIngestResult = {
  ok: true;
  attributionToken: string | null;
  sessionTimeoutMinutes: number;
};

export async function ingestBrowserEvent(input: {
  siteKey: string;
  originHeader: string | null;
  monitorHeader: string | null;
  payload: unknown;
}): Promise<
  | BrowserIngestResult
  | { ok: false; status: number; error: string; log?: string }
> {
  if (input.monitorHeader === "1") {
    return { ok: true, attributionToken: null, sessionTimeoutMinutes: 30 };
  }
  const config = await findConfigBySiteKey(input.siteKey);
  if (!config) {
    incrementTrackingMetric("tracking_events_rejected");
    return { ok: false, status: 400, error: "Invalid request." };
  }
  if (config.status !== "ENABLED" || config.website.status !== "ACTIVE") {
    incrementTrackingMetric("tracking_events_rejected");
    logger.info("tracking.origin_rejected", {
      websiteId: config.websiteId,
      reason: "disabled",
    });
    return { ok: false, status: 400, error: "Invalid request." };
  }
  const origin = parseOriginHeader(input.originHeader);
  if (
    !originsMatchWebsite({
      requestOrigin: origin,
      websiteOrigin: config.website.normalizedUrl,
    })
  ) {
    incrementTrackingMetric("tracking_events_rejected");
    logger.info("tracking.origin_rejected", {
      organizationId: config.organizationId,
      websiteId: config.websiteId,
    });
    return { ok: false, status: 400, error: "Invalid request." };
  }
  if (!input.payload || typeof input.payload !== "object") {
    return { ok: false, status: 400, error: "Invalid request." };
  }
  const body = input.payload as Record<string, unknown>;
  if (body.consent !== "granted") {
    return { ok: false, status: 400, error: "Invalid request." };
  }
  const eventId = isUuid(body.eventId) ? body.eventId : randomUUID();
  const visitorId = isUuid(body.visitorId) ? body.visitorId : null;
  const sessionId = isUuid(body.sessionId) ? body.sessionId : null;
  if (!visitorId || !sessionId) {
    return { ok: false, status: 400, error: "Invalid request." };
  }
  const type = body.type === "lead" ? "LEAD_CREATED" : "SESSION_STARTED";
  const now = new Date();
  const ingested = await database.trackingIngestionEvent.findUnique({
    where: { websiteId_eventId: { websiteId: config.websiteId, eventId } },
  });
  if (ingested) {
    const token = await issueTokenForExisting(
      config,
      visitorId,
      sessionId,
      now,
    );
    return {
      ok: true,
      attributionToken: token,
      sessionTimeoutMinutes: config.sessionTimeoutMinutes,
    };
  }

  await database.trackingIngestionEvent.create({
    data: {
      organizationId: config.organizationId,
      websiteId: config.websiteId,
      eventId,
      type,
      status: "RECEIVED",
      receivedAt: now,
    },
  });

  const landing =
    typeof body.landingUrl === "string"
      ? sanitizeLandingUrl(body.landingUrl)
      : {
          origin:
            typeof body.landingOrigin === "string" ? body.landingOrigin : null,
          pathname: sanitizePathname(body.landingPath),
        };
  const referrerDomain = sanitizeReferrerDomain(
    body.referrerDomain ?? body.referrer,
  );
  const clickSource =
    body.clickIds && typeof body.clickIds === "object"
      ? (body.clickIds as Record<string, unknown>)
      : body;
  const ids: GoogleClickIds = {
    gclid: parseClickId(clickSource.gclid),
    gbraid: parseClickId(clickSource.gbraid),
    wbraid: parseClickId(clickSource.wbraid),
  };
  const utm = parseUtmFromUnknown(body.utm ?? body);

  try {
    const { visitor, session } = await upsertVisitorSession({
      config,
      visitorId,
      sessionId,
      landingOrigin: landing.origin,
      landingPath: landing.pathname,
      referrerDomain,
      now,
    });
    const touch = await captureTouch({
      config,
      visitorId: visitor.id,
      sessionId: session.id,
      ids,
      landingOrigin: landing.origin,
      landingPath: landing.pathname,
      utm,
      now,
    });
    const token = await issueToken({
      config,
      visitorId: visitor.id,
      sessionId: session.id,
      now,
    });
    if (type === "LEAD_CREATED") {
      const external =
        typeof body.externalLeadId === "string" && body.externalLeadId.trim()
          ? body.externalLeadId.trim().slice(0, 191)
          : null;
      await attributeAndCreateLead({
        config,
        source: "BROWSER_SDK",
        eventId,
        externalLeadId: external,
        visitorId: visitor.id,
        sessionId: session.id,
        occurredAt: now,
        now,
      });
      void touch;
    }
    await database.trackingIngestionEvent.update({
      where: { websiteId_eventId: { websiteId: config.websiteId, eventId } },
      data: { status: "PROCESSED", processedAt: now },
    });
    await database.websiteTrackingConfig.update({
      where: { id: config.id },
      data: {
        lastEventReceivedAt: now,
        lastAttributionReceivedAt: hasAnyClickId(ids) ? now : undefined,
      },
    });
    incrementTrackingMetric("tracking_events_received");
    return {
      ok: true,
      attributionToken: token,
      sessionTimeoutMinutes: config.sessionTimeoutMinutes,
    };
  } catch (error) {
    incrementTrackingMetric("tracking_events_rejected");
    logger.warn("tracking.events.rejected", {
      organizationId: config.organizationId,
      websiteId: config.websiteId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, status: 400, error: "Invalid request." };
  }
}

async function issueTokenForExisting(
  config: TrackingConfigRow,
  publicVisitorId: string,
  publicSessionId: string,
  now: Date,
) {
  const session = await database.attributionSession.findUnique({
    where: {
      websiteId_publicSessionId: {
        websiteId: config.websiteId,
        publicSessionId,
      },
    },
  });
  const visitor = await database.attributionVisitor.findUnique({
    where: {
      websiteId_publicVisitorId: {
        websiteId: config.websiteId,
        publicVisitorId,
      },
    },
  });
  if (!session || !visitor) return null;
  return issueToken({
    config,
    visitorId: visitor.id,
    sessionId: session.id,
    now,
  });
}

export async function ingestServerLead(input: {
  secret: string;
  payload: unknown;
}): Promise<
  | {
      ok: true;
      publicLeadId: string;
      duplicate: boolean;
      attributionStatus: string;
    }
  | { ok: false; status: number; error: string }
> {
  const config = await findConfigByServerSecret(input.secret);
  if (!config) return { ok: false, status: 401, error: "Unauthorized." };
  if (config.status !== "ENABLED" || config.website.status !== "ACTIVE") {
    return { ok: false, status: 400, error: "Tracking is disabled." };
  }
  if (!input.payload || typeof input.payload !== "object") {
    return { ok: false, status: 400, error: "Invalid payload." };
  }
  const body = input.payload as Record<string, unknown>;
  if (!isUuid(body.eventId)) {
    return { ok: false, status: 400, error: "eventId must be a UUID." };
  }
  const tokenValue =
    typeof body.attributionToken === "string" ? body.attributionToken : "";
  const token = await loadToken(tokenValue);
  if (!token) {
    logger.info("tracking.invalid_token", {
      organizationId: config.organizationId,
      websiteId: config.websiteId,
    });
    return { ok: false, status: 400, error: "Invalid attribution token." };
  }
  if (token.websiteId !== config.websiteId) {
    logger.info("tracking.invalid_token", {
      organizationId: config.organizationId,
      websiteId: config.websiteId,
      reason: "cross_site",
    });
    return { ok: false, status: 400, error: "Invalid attribution token." };
  }
  const now = new Date();
  const tracking = getTrackingConfig();
  let occurredAt = now;
  if (typeof body.occurredAt === "string") {
    const parsed = new Date(body.occurredAt);
    if (
      !Number.isNaN(parsed.getTime()) &&
      Math.abs(parsed.getTime() - now.getTime()) <=
        tracking.clientOccurredAtSkewMs
    ) {
      occurredAt = parsed;
    }
  }
  const tokenExpired = token.expiresAt.getTime() <= now.getTime();
  const external =
    typeof body.externalLeadId === "string" && body.externalLeadId.trim()
      ? body.externalLeadId.trim().slice(0, 191)
      : null;
  const result = await attributeAndCreateLead({
    config,
    source: "SERVER_API",
    eventId: body.eventId,
    externalLeadId: external,
    visitorId: tokenExpired ? null : token.visitorId,
    sessionId: tokenExpired ? null : token.sessionId,
    occurredAt,
    now,
  });
  if (tokenExpired) {
    await database.leadAttribution.updateMany({
      where: { leadId: result.lead.id, finalizedAt: { not: null } },
      data: {
        attributionStatus: "EXPIRED",
        firstTouchId: null,
        primaryTouchId: null,
        visitorId: null,
        sessionId: null,
        finalizedAt: now,
      },
    });
  }
  await database.attributionToken.update({
    where: { id: token.id },
    data: { lastUsedAt: now },
  });
  const attribution = await database.leadAttribution.findUnique({
    where: { leadId: result.lead.id },
  });
  return {
    ok: true,
    publicLeadId: result.lead.publicLeadId,
    duplicate: result.duplicate,
    attributionStatus: attribution?.attributionStatus ?? "UNATTRIBUTED",
  };
}

export async function deleteVisitorTrackingData(input: {
  organizationId: string;
  visitorId: string;
}) {
  const visitor = await database.attributionVisitor.findFirst({
    where: { id: input.visitorId, organizationId: input.organizationId },
  });
  if (!visitor) return;
  await database.$transaction([
    database.leadAttribution.updateMany({
      where: { visitorId: visitor.id },
      data: {
        attributionStatus: "DELETED",
        firstTouchId: null,
        primaryTouchId: null,
      },
    }),
    database.attributionTouch.deleteMany({ where: { visitorId: visitor.id } }),
    database.attributionToken.deleteMany({ where: { visitorId: visitor.id } }),
    database.attributionSession.deleteMany({
      where: { visitorId: visitor.id },
    }),
    database.attributionVisitor.delete({ where: { id: visitor.id } }),
  ]);
}

export async function deleteLeadTrackingData(input: {
  organizationId: string;
  leadId: string;
}) {
  await database.$transaction(async (tx) => {
    await tx.googleAdsConversionExport.updateMany({
      where: {
        leadId: input.leadId,
        organizationId: input.organizationId,
        status: {
          in: ["PENDING", "BLOCKED", "READY", "RETRYABLE_ERROR", "SUBMITTING"],
        },
      },
      data: {
        status: "CANCELLED",
        blockReason: "NO_IDENTIFIER",
        lastErrorCode: "PRIVACY_DELETED",
        completedAt: new Date(),
        nextAttemptAt: null,
      },
    });
    await tx.lead.deleteMany({
      where: { id: input.leadId, organizationId: input.organizationId },
    });
  });
}

export async function cleanupExpiredTrackingData(now = new Date()) {
  const config = getTrackingConfig();
  const tokens = await database.attributionToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const expiredTouches = await database.attributionTouch.findMany({
    where: {
      expiresAt: { lt: now },
      firstForLeads: { none: {} },
      primaryForLeads: { none: {} },
    },
    select: { id: true },
    take: config.retentionBatchSize,
  });
  const touches = expiredTouches.length
    ? await database.attributionTouch.deleteMany({
        where: { id: { in: expiredTouches.map((row) => row.id) } },
      })
    : { count: 0 };
  const visitors = await database.attributionVisitor.findMany({
    where: { expiresAt: { lt: now }, leads: { none: {} } },
    select: { id: true },
    take: config.retentionBatchSize,
  });
  if (visitors.length) {
    const ids = visitors.map((row) => row.id);
    await database.attributionToken.deleteMany({
      where: { visitorId: { in: ids } },
    });
    await database.attributionSession.deleteMany({
      where: { visitorId: { in: ids } },
    });
    await database.attributionVisitor.deleteMany({
      where: { id: { in: ids } },
    });
  }
  return {
    tokens: tokens.count,
    touches: touches.count,
    visitors: visitors.length,
  };
}

export async function finalizePendingAttributions(now = new Date()) {
  const horizon = addMinutes(now, -getTrackingConfig().reconciliationMinutes);
  const pending = await database.leadAttribution.findMany({
    where: {
      attributionStatus: "PENDING_ATTRIBUTION",
      createdAt: { lt: horizon },
    },
    take: 100,
  });
  for (const row of pending) {
    await database.leadAttribution.update({
      where: { id: row.id },
      data: { attributionStatus: "UNATTRIBUTED", finalizedAt: now },
    });
  }
  return pending.length;
}
