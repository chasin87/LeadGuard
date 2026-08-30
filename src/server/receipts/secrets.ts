import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateReceiptWebhookSecret(): string {
  return `lgrw_${randomBytes(32).toString("hex")}`;
}

export function hashReceiptSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function receiptSecretPrefix(secret: string): string {
  return `${secret.slice(0, 8)}…`;
}

export function receiptSecretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
