import { NextRequest } from "next/server";
import { getBillingConfig } from "@/server/billing/config";
import { getBillingProvider } from "@/server/billing/clients";
import { applyVerifiedBillingEvent } from "@/server/billing/projection";
import { createLogger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("billing");

export async function POST(request: NextRequest) {
  const config = getBillingConfig();
  const raw = await request.arrayBuffer();
  if (raw.byteLength > config.webhookMaxBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const payload = Buffer.from(raw).toString("utf8");
  const signature = request.headers.get("stripe-signature");
  const provider = getBillingProvider();
  if (!provider.verifyWebhook) {
    return Response.json({ error: "unsupported" }, { status: 400 });
  }
  let event;
  try {
    event = await provider.verifyWebhook(payload, signature);
  } catch {
    logger.warn("billing.webhook.invalid_signature");
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }
  logger.info("billing.webhook.received", { type: event.type });
  try {
    await applyVerifiedBillingEvent(event);
  } catch (error) {
    logger.error("billing.webhook.failed", {
      type: event.type,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
