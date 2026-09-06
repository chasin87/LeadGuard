import { createHash } from "node:crypto";

export function mutationIdForExternalEvent(
  integrationId: string,
  sourceEventId: string,
): string {
  const hash = createHash("sha256")
    .update(`external:${integrationId}:${sourceEventId}`, "utf8")
    .digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
