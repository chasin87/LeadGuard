import { NextRequest } from "next/server";
import { createLogger } from "@/server/logger";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { authorizeInboundEmailRequest } from "@/server/receipts/auth";
import {
  getReceiptConfig,
  type InboundEmailProviderName,
} from "@/server/receipts/config";
import { normalizeInboundMessage } from "@/server/receipts/inbound";
import { processInboundEmailCallback } from "@/server/receipts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("inbound-email");

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const config = getReceiptConfig();
  if (provider === "dev" && process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (provider !== config.provider) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (!config.inboundReady) {
    logger.warn("receipt.email.provider_unavailable", { provider });
    return Response.json(
      { error: "Inbound email is not configured." },
      {
        status: 503,
      },
    );
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > config.maxInboundBodyBytes) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  const ip = clientIp(request);
  const limit = consumeRateLimit(
    `inbound-email:${ip}`,
    config.webhookRateLimit,
    config.webhookRateWindowMs,
  );
  if (!limit.ok) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }
  const rawBody = await request.text();
  if (rawBody.length > config.maxInboundBodyBytes) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  if (
    !authorizeInboundEmailRequest({
      authorizationHeader: request.headers.get("authorization"),
      timestampHeader: request.headers.get("x-leadguard-timestamp"),
      signatureHeader: request.headers.get("x-leadguard-signature"),
      rawBody,
      secret: config.webhookSecret,
    })
  ) {
    logger.info("receipt.email.invalid_signature", { provider });
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ accepted: true }, { status: 202 });
  }
  const message = normalizeInboundMessage(
    parsed,
    provider as InboundEmailProviderName,
  );
  if (!message) {
    return Response.json({ accepted: true }, { status: 202 });
  }
  logger.info("receipt.email.received", {
    provider,
    messageId: message.messageId,
  });
  await processInboundEmailCallback({ provider, message });
  return Response.json({ accepted: true }, { status: 202 });
}
