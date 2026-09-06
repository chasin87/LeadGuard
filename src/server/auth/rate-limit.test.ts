import { afterEach, describe, expect, it } from "vitest";
import {
  clientRateLimitIdentity,
  consumeRateLimit,
  resetRateLimitStore,
} from "./rate-limit";

afterEach(() => resetRateLimitStore());

function headers(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

describe("rate limiting", () => {
  it("allows traffic under the limit and then blocks", () => {
    expect(consumeRateLimit("login:test", 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit("login:test", 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit("login:test", 2, 60_000).ok).toBe(false);
  });

  it("ignores the test-run header when isolation is disabled, including production", () => {
    const identity = clientRateLimitIdentity(
      headers({
        "x-forwarded-for": "203.0.113.10",
        "x-leadguard-test-run-id": "evil-run",
        "x-leadguard-test-worker-id": "99",
      }),
      { NODE_ENV: "production" },
    );
    expect(identity).toBe("203.0.113.10");
  });

  it("does not let NODE_ENV=production plus the test header bypass the limiter", () => {
    const key = clientRateLimitIdentity(
      headers({
        "x-forwarded-for": "203.0.113.11",
        "x-leadguard-test-run-id": "bypass-attempt",
      }),
      { NODE_ENV: "production", E2E_RATE_LIMIT_ISOLATION: "false" },
    );
    expect(key).toBe("203.0.113.11");
    expect(consumeRateLimit(`register:${key}`, 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit(`register:${key}`, 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit(`register:${key}`, 2, 60_000).ok).toBe(false);
  });

  it("scopes keys per run and worker only when isolation is explicitly enabled", () => {
    const identity = clientRateLimitIdentity(
      headers({
        "x-forwarded-for": "127.0.0.1",
        "x-leadguard-test-run-id": "run-a",
        "x-leadguard-test-worker-id": "3",
      }),
      { E2E_RATE_LIMIT_ISOLATION: "true", NODE_ENV: "production" },
    );
    expect(identity).toBe("test:run-a:3");
    expect(consumeRateLimit(`register:${identity}`, 1, 60_000).ok).toBe(true);
    expect(consumeRateLimit(`register:${identity}`, 1, 60_000).ok).toBe(false);
    expect(consumeRateLimit("register:test:run-a:4", 1, 60_000).ok).toBe(true);
    expect(consumeRateLimit("register:test:run-b:3", 1, 60_000).ok).toBe(true);
  });
});
