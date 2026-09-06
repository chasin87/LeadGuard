import { NextRequest } from "next/server";
import {
  clientRateLimitIdentity,
  consumeRateLimit,
} from "@/server/auth/rate-limit";
import { createLogger } from "@/server/logger";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";
import { authenticateOutcomeRequest } from "@/server/outcomes/auth";
import { parseOutcomeEventPayload } from "@/server/outcomes/normalize";
import { ingestParsedOutcomeEvent } from "@/server/outcomes/service";
import type { AuthenticatedOutcomeIntegration } from "@/server/outcomes/auth";
import type { IngestOutcomeResult } from "@/server/outcomes/service";

const logger = createLogger("outcome-api");

function clientIp(request: NextRequest) {
  return clientRateLimitIdentity(request.headers);
}

function genericAuthError(code: string) {
  if (code === "INTEGRATION_DISABLED") {
    return Response.json(
      { error: "Integration is disabled.", code: "INTEGRATION_DISABLED" },
      { status: 403 },
    );
  }
  if (code === "EXPIRED_TIMESTAMP") {
    return Response.json(
      { error: "Request timestamp is outside the replay window." },
      { status: 401 },
    );
  }
  return Response.json({ error: "Unauthorized." }, { status: 401 });
}

function publicResult(result: IngestOutcomeResult) {
  return {
    eventId: result.eventId,
    status: result.status,
    leadId: result.leadId,
    errorCode: result.errorCode,
  };
}

export async function readOutcomeRequest(request: NextRequest): Promise<
  | {
      ok: true;
      raw: string;
      payload: unknown;
      integration: AuthenticatedOutcomeIntegration;
    }
  | { ok: false; response: Response }
> {
  const config = getOutcomeIngestionConfig();
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid request." }, { status: 400 }),
    };
  }
  if (Buffer.byteLength(raw, "utf8") > config.maxBodyBytes) {
    return {
      ok: false,
      response: Response.json({ error: "Payload too large." }, { status: 413 }),
    };
  }
  const auth = await authenticateOutcomeRequest({
    authorizationHeader: request.headers.get("authorization"),
    integrationIdHeader: request.headers.get("x-leadguard-integration"),
    timestampHeader: request.headers.get("x-leadguard-timestamp"),
    signatureHeader: request.headers.get("x-leadguard-signature"),
    rawBody: raw,
  });
  if (!auth.ok) {
    logger.info("outcome_ingestion.received", {
      authenticated: false,
      errorCode: auth.code,
    });
    return { ok: false, response: genericAuthError(auth.code) };
  }
  const ip = clientIp(request);
  const limits = [
    consumeRateLimit(
      `outcome:${auth.integration.id}`,
      config.credentialRateLimit,
      config.rateWindowMs,
    ),
    consumeRateLimit(
      `outcome-org:${auth.integration.organizationId}`,
      config.organizationRateLimit,
      config.rateWindowMs,
    ),
    consumeRateLimit(
      `outcome-ip:${ip}`,
      config.ipRateLimit,
      config.rateWindowMs,
    ),
  ];
  if (limits.some((item) => !item.ok)) {
    const retry = limits.find((item) => !item.ok);
    return {
      ok: false,
      response: Response.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              retry && !retry.ok ? retry.retryAfterSeconds : 60,
            ),
          },
        },
      ),
    };
  }
  let payload: unknown;
  try {
    payload = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON." }, { status: 400 }),
    };
  }
  logger.info("outcome_ingestion.received", {
    organizationId: auth.integration.organizationId,
    integrationId: auth.integration.id,
  });
  return { ok: true, raw, payload, integration: auth.integration };
}

export async function ingestOutcomePayload(input: {
  integration: AuthenticatedOutcomeIntegration;
  payload: unknown;
  persist: boolean;
}): Promise<IngestOutcomeResult> {
  const parsed = parseOutcomeEventPayload(input.payload);
  if (!parsed.ok) {
    return {
      eventId:
        input.payload && typeof input.payload === "object"
          ? String((input.payload as { eventId?: unknown }).eventId ?? "") ||
            "unknown"
          : "unknown",
      status: "REJECTED",
      leadId: null,
      errorCode: parsed.code,
      externalEventId: null,
    };
  }
  return ingestParsedOutcomeEvent({
    integration: input.integration,
    parsed: parsed.value,
    persist: input.persist,
    outcomeSource: "API",
  });
}

export { publicResult };
