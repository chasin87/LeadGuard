import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateWebhookSecret(): string {
  return `lgwh_${randomBytes(32).toString("hex")}`;
}

export function webhookSignaturePayload(
  timestamp: string,
  body: string,
): string {
  return `${timestamp}.${body}`;
}

export function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(webhookSignaturePayload(timestamp, body), "utf8")
    .digest("hex");
  return `sha256=${digest}`;
}

export function webhookSignaturesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
