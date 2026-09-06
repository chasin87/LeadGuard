import { NextRequest } from "next/server";
import {
  clientRateLimitIdentity,
  consumeRateLimit,
} from "@/server/auth/rate-limit";
import { createLogger } from "@/server/logger";
import { getTrackingConfig } from "@/server/tracking/config";
import { corsHeaders, parseOriginHeader } from "@/server/tracking/origin";
import { incrementTrackingMetric } from "@/server/tracking/metrics";
import { ingestBrowserEvent } from "@/server/tracking/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("tracking-events");

function clientIdentity(request: NextRequest) {
  return clientRateLimitIdentity(request.headers);
}

function optionsResponse(origin: string | null) {
  if (!origin) return new Response(null, { status: 204 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(parseOriginHeader(request.headers.get("origin")));
}

export async function POST(request: NextRequest) {
  const config = getTrackingConfig();
  const origin = parseOriginHeader(request.headers.get("origin"));
  const headers = origin ? corsHeaders(origin) : {};
  const ip = clientIdentity(request);
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers },
    );
  }
  if (Buffer.byteLength(raw, "utf8") > config.maxBodyBytes) {
    return Response.json(
      { error: "Invalid request." },
      { status: 413, headers },
    );
  }
  let payload: unknown;
  try {
    payload = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers },
    );
  }
  const siteKey =
    payload && typeof payload === "object"
      ? String((payload as { siteKey?: unknown }).siteKey ?? "")
      : "";
  const limit = consumeRateLimit(
    `tracking-events:${siteKey.slice(0, 24)}:${origin ?? "none"}:${ip}`,
    config.publicEventRateLimit,
    config.publicEventRateWindowMs,
  );
  if (!limit.ok) {
    incrementTrackingMetric("tracking_rate_limited");
    logger.info("tracking.rate_limited", { scope: "events" });
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers },
    );
  }
  const result = await ingestBrowserEvent({
    siteKey,
    originHeader: request.headers.get("origin"),
    monitorHeader: request.headers.get("x-leadguard-monitor"),
    payload,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers },
    );
  }
  return Response.json(
    {
      ok: true,
      attributionToken: result.attributionToken,
      sessionTimeoutMinutes: result.sessionTimeoutMinutes,
    },
    {
      headers: {
        ...headers,
        "Cache-Control": "no-store",
      },
    },
  );
}
