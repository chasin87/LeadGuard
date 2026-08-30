import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { DomainError } from "@/server/authorization/errors";
import { getGoogleAdsProviderKind } from "@/server/google-ads/config";

export const credentialEncryptionVersion = 1;
const algorithm = "aes-256-gcm";
const ivLength = 12;
const authTagLength = 16;
const keyLength = 32;
const prefix = `v${credentialEncryptionVersion}:`;
const developmentFallbackMaterial =
  "leadguard-dev-only-credential-encryption-key";

function decodeKeyMaterial(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const fromBase64 = Buffer.from(trimmed, "base64");
    if (fromBase64.length === keyLength) return fromBase64;
  } catch {
    return null;
  }
  if (trimmed.length >= keyLength) {
    return createHash("sha256").update(trimmed).digest();
  }
  return null;
}

export function resolveCredentialEncryptionKey(
  values: Record<string, string | undefined> = process.env,
): Buffer {
  const configured = values.CREDENTIAL_ENCRYPTION_KEY;
  if (configured) {
    const decoded = decodeKeyMaterial(configured);
    if (!decoded || decoded.length !== keyLength) {
      throw new DomainError(
        "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes as hex or base64.",
      );
    }
    return decoded;
  }

  if (getGoogleAdsProviderKind() === "fake") {
    return createHash("sha256").update(developmentFallbackMaterial).digest();
  }

  throw new DomainError("LeadGuard is missing CREDENTIAL_ENCRYPTION_KEY.");
}

export function encryptSecret(
  plaintext: string,
  key = resolveCredentialEncryptionKey(),
): { ciphertext: string; version: number } {
  if (!plaintext) {
    throw new DomainError("Cannot encrypt an empty credential.");
  }
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, key, iv, {
    authTagLength,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `${prefix}${Buffer.concat([iv, tag, encrypted]).toString("base64")}`,
    version: credentialEncryptionVersion,
  };
}

export function decryptSecret(
  ciphertext: string,
  key = resolveCredentialEncryptionKey(),
): string {
  if (!ciphertext.startsWith(prefix)) {
    throw new DomainError("Unsupported credential encryption version.");
  }
  let payload: Buffer;
  try {
    payload = Buffer.from(ciphertext.slice(prefix.length), "base64");
  } catch {
    throw new DomainError("Stored credential is not valid ciphertext.");
  }
  if (payload.length <= ivLength + authTagLength) {
    throw new DomainError("Stored credential is not valid ciphertext.");
  }
  const iv = payload.subarray(0, ivLength);
  const tag = payload.subarray(ivLength, ivLength + authTagLength);
  const encrypted = payload.subarray(ivLength + authTagLength);
  try {
    const decipher = createDecipheriv(algorithm, key, iv, {
      authTagLength,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DomainError("Stored credential could not be decrypted.");
  }
}

export function isPlaintextCredential(
  value: string,
  plaintext: string,
): boolean {
  return value === plaintext;
}
