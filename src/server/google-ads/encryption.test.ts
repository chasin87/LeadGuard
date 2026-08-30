import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError } from "@/server/authorization/errors";
import {
  decryptSecret,
  encryptSecret,
  resolveCredentialEncryptionKey,
} from "@/server/google-ads/encryption";

const key = randomBytes(32);

describe("credential encryption", () => {
  it("round-trips a refresh token without storing plaintext", () => {
    const token = "1//refresh-token-value";
    const encrypted = encryptSecret(token, key);
    expect(encrypted.ciphertext).not.toContain(token);
    expect(encrypted.ciphertext.startsWith("v1:")).toBe(true);
    expect(decryptSecret(encrypted.ciphertext, key)).toBe(token);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("secret-token", key);
    const payload = Buffer.from(encrypted.ciphertext.slice(3), "base64");
    const index = 20;
    const current = payload[index];
    if (current === undefined) {
      throw new Error("ciphertext too short");
    }
    payload[index] = current ^ 0xff;
    const tampered = `v1:${payload.toString("base64")}`;
    expect(() => decryptSecret(tampered, key)).toThrow(DomainError);
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptSecret("secret-token", key);
    const other = randomBytes(32);
    expect(() => decryptSecret(encrypted.ciphertext, other)).toThrow(
      DomainError,
    );
  });

  it("parses a 32-byte base64 key", () => {
    const material = randomBytes(32).toString("base64");
    expect(
      resolveCredentialEncryptionKey({ CREDENTIAL_ENCRYPTION_KEY: material })
        .length,
    ).toBe(32);
  });

  it("does not treat sha256 of a token as the stored value", () => {
    const token = "1//refresh-token-value";
    const hash = createHash("sha256").update(token).digest("hex");
    const encrypted = encryptSecret(token, key);
    expect(encrypted.ciphertext).not.toBe(hash);
    expect(encrypted.ciphertext).not.toBe(token);
  });
});
