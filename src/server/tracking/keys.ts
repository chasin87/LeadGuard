import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generatePublicSiteKey(): string {
  return `lg_site_${randomBytes(24).toString("base64url")}`;
}

export function generateServerIngestionSecret(): string {
  return `lgsrv_${randomBytes(32).toString("hex")}`;
}

export function generateAttributionToken(): string {
  return `lgat_${randomBytes(32).toString("hex")}`;
}

export function generatePublicLeadId(): string {
  return `lgl_${randomBytes(16).toString("hex")}`;
}

export function hashTrackingSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function trackingSecretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isPublicSiteKey(value: string): boolean {
  return /^lg_site_[A-Za-z0-9_-]{20,64}$/.test(value);
}

export function isServerIngestionSecret(value: string): boolean {
  return /^lgsrv_[0-9a-f]{64}$/.test(value);
}

export function isAttributionToken(value: string): boolean {
  return /^lgat_[0-9a-f]{64}$/.test(value);
}
