import { NextRequest } from "next/server";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { createLogger } from "@/server/logger";
import { getTrackingConfig } from "@/server/tracking/config";
import { incrementTrackingMetric } from "@/server/tracking/metrics";
import { ingestServerLead } from "@/server/tracking/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("tracking-leads");

function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  const config = getTrackingConfig();
  const secret = bearerToken(request);
  if (!secret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const limit = consumeRateLimit(
    `tracking-leads:${secret.slice(0, 16)}`,
    config.serverLeadRateLimit,
    config.serverLeadRateWindowMs,
  );
  if (!limit.ok) {
    incrementTrackingMetric("tracking_rate_limited");
    logger.info("tracking.rate_limited", { scope: "server_leads" });
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > config.maxBodyBytes) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }
  const result = await ingestServerLead({ secret, payload });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(
    {
      ok: true,
      leadId: result.publicLeadId,
      duplicate: result.duplicate,
      attributionStatus: result.attributionStatus,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
