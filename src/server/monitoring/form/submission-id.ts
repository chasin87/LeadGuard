import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const tokenLength = 12;
export const submissionIdPattern = /LG-\d{8}-[A-HJ-NP-Z2-9]{6,16}/;

export function createFormSubmissionId(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `LG-${date}-${randomToken(tokenLength)}`;
}

export function applyPlusAddressing(
  email: string,
  submissionId: string,
): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain || local.includes("+")) return email;
  const marker = submissionId.replaceAll("-", "").slice(0, 16);
  return `${local}+${marker}@${domain}`;
}

export function extractSubmissionId(value: string): string | null {
  const bounded = value.slice(0, 8_000);
  const match = bounded.toUpperCase().match(submissionIdPattern);
  return match ? match[0] : null;
}

function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let token = "";
  for (const byte of bytes) {
    token += alphabet[byte % alphabet.length];
  }
  return token;
}
