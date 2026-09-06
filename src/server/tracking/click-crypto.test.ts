import { describe, expect, it } from "vitest";
import {
  decryptClickId,
  encryptClickId,
  hashClickId,
} from "@/server/tracking/click-crypto";

describe("click ID crypto", () => {
  it("round-trips a click ID and keeps a lookup hash", () => {
    const value = "Cj0KCQjwTESTCLICK";
    const encrypted = encryptClickId(value);
    expect(encrypted).not.toContain(value);
    expect(decryptClickId(encrypted)).toBe(value);
    expect(hashClickId(value)).toHaveLength(64);
    expect(hashClickId(value)).toBe(hashClickId(value));
    expect(hashClickId(value)).not.toBe(hashClickId(`${value}x`));
  });
});
