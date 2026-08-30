import { afterEach, describe, expect, it } from "vitest";
import { consumeRateLimit, resetRateLimitStore } from "./rate-limit";

afterEach(() => resetRateLimitStore());

describe("rate limiting", () => {
  it("allows traffic under the limit and then blocks", () => {
    expect(consumeRateLimit("login:test", 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit("login:test", 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit("login:test", 2, 60_000).ok).toBe(false);
  });
});
