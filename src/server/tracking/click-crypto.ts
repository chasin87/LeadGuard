import { createHmac, hkdfSync } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  resolveCredentialEncryptionKey,
} from "@/server/google-ads/encryption";

function derivedKey(info: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      resolveCredentialEncryptionKey(),
      "leadguard-tracking",
      info,
      32,
    ),
  );
}

export function clickIdEncryptionKey(): Buffer {
  return derivedKey("click-id-aes-v1");
}

export function clickIdHmacKey(): Buffer {
  return derivedKey("click-id-hmac-v1");
}

export function encryptClickId(value: string): string {
  return encryptSecret(value, clickIdEncryptionKey()).ciphertext;
}

export function decryptClickId(ciphertext: string): string {
  return decryptSecret(ciphertext, clickIdEncryptionKey());
}

export function hashClickId(value: string): string {
  return createHmac("sha256", clickIdHmacKey())
    .update(value, "utf8")
    .digest("hex");
}
