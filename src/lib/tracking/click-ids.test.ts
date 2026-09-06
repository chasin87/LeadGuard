import { describe, expect, it } from "vitest";
import {
  extractClickIdsFromSearchParams,
  isValidClickId,
  parseClickId,
} from "@/lib/tracking/click-ids";

describe("click ID capture", () => {
  it("keeps gclid, gbraid and wbraid without changing case", () => {
    const ids = extractClickIdsFromSearchParams(
      new URLSearchParams("gclid=AbC&gbraid=XyZ&wbraid=123"),
    );
    expect(ids).toEqual({ gclid: "AbC", gbraid: "XyZ", wbraid: "123" });
  });

  it("rejects control characters and oversized values", () => {
    expect(parseClickId("ok-id")).toBe("ok-id");
    expect(parseClickId("bad\nid")).toBeNull();
    expect(isValidClickId("a".repeat(513))).toBe(false);
  });

  it("does not lowercase identifiers", () => {
    expect(parseClickId("CASE-Sensitive")).toBe("CASE-Sensitive");
  });
});
