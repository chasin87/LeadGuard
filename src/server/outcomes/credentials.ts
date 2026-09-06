import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OUTCOME_CREDENTIAL_PREFIX = "lgoi_";
export const OUTCOME_SIGNING_SECRET_PREFIX = "lgos_";

export function generateOutcomeIntegrationCredential(): string {
  return `${OUTCOME_CREDENTIAL_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function generateOutcomeSigningSecret(): string {
  return `${OUTCOME_SIGNING_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashOutcomeSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function outcomeSecretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isOutcomeIntegrationCredential(value: string): boolean {
  return /^lgoi_[0-9a-f]{64}$/.test(value);
}

export function isOutcomeSigningSecret(value: string): boolean {
  return /^lgos_[0-9a-f]{64}$/.test(value);
}

export function outcomeCredentialPrefix(value: string): string {
  return value.slice(0, 12);
}

export function maskOutcomeCredential(prefix: string): string {
  return `${prefix}••••`;
}
