import { NextRequest } from "next/server";
import { createLogger } from "@/server/logger";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { database } from "@/server/database";
import { extractSubmissionId } from "@/server/monitoring/form/submission-id";
import { getReceiptConfig } from "@/server/receipts/config";
import { hashReceiptSecret } from "@/server/receipts/secrets";
import { processAuthenticatedReceipt } from "@/server/receipts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("receipt-webhook");

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  const config = getReceiptConfig();
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > config.maxInboundBodyBytes) {
    return Response.json({ error: "Payload too large." }, { status: 413 });
  }
  const ip = clientIp(request);
  const limit = consumeRateLimit(
    `receipt-webhook:${ip}`,
    config.webhookRateLimit,
    config.webhookRateWindowMs,
  );
  if (!limit.ok) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }
  const secret = bearerToken(request);
  if (!secret) {
    logger.info("receipt.webhook.invalid_signature", {
      reason: "missing_bearer",
    });
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const hash = hashReceiptSecret(secret);
  const credentialLimit = consumeRateLimit(
    `receipt-webhook:secret:${hash.slice(0, 16)}`,
    config.webhookRateLimit,
    config.webhookRateWindowMs,
  );
  if (!credentialLimit.ok) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }
  const formConfig = await database.formMonitorConfig.findFirst({
    where: { receiptWebhookSecretHash: hash },
    select: {
      monitorId: true,
      receiptMode: true,
      monitor: {
        select: {
          id: true,
          deletedAt: true,
          website: { select: { organizationId: true } },
        },
      },
    },
  });
  if (!formConfig || formConfig.receiptMode !== "RECEIPT_WEBHOOK") {
    logger.info("receipt.webhook.invalid_signature", {
      reason: "unknown_secret",
    });
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ accepted: true }, { status: 202 });
  }
  const submissionId =
    payload && typeof payload === "object"
      ? extractSubmissionId(
          String((payload as { submissionId?: unknown }).submissionId ?? ""),
        )
      : null;
  if (
    !submissionId ||
    formConfig.monitor.deletedAt ||
    formConfig.receiptMode !== "RECEIPT_WEBHOOK"
  ) {
    return Response.json({ accepted: true }, { status: 202 });
  }
  await processAuthenticatedReceipt({
    submissionId,
    organizationId: formConfig.monitor.website.organizationId,
    monitorId: formConfig.monitorId,
    method: "WEBHOOK",
    receivedAt: new Date(),
  });
  return Response.json({ accepted: true }, { status: 202 });
}
