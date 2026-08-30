import {
  signWebhookBody,
  webhookSignaturesMatch,
} from "@/server/notifications/webhooks/signature";
import { getReceiptConfig } from "@/server/receipts/config";

export function authorizeInboundEmailRequest(input: {
  authorizationHeader: string | null;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  secret: string;
  now?: Date;
}): boolean {
  const token = input.authorizationHeader
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (token && webhookSignaturesMatch(token, input.secret)) return true;
  const timestamp = input.timestampHeader ?? "";
  const signature = input.signatureHeader ?? "";
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  const now = input.now ?? new Date();
  if (Math.abs(now.getTime() - tsMs) > getReceiptConfig().hmacWindowMs) {
    return false;
  }
  const expected = signWebhookBody(input.secret, timestamp, input.rawBody);
  return webhookSignaturesMatch(signature, expected);
}
