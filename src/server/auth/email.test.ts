import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("email normalization", () => {
  it("trims and lowercases addresses", () => {
    expect(normalizeEmail("  yasin@Example.COM ")).toBe("yasin@example.com");
  });
});
