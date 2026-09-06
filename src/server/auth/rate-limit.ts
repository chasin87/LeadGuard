type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export type RateLimitResult =
  { ok: true } | { ok: false; retryAfterSeconds: number };

export const E2E_TEST_RUN_HEADER = "x-leadguard-test-run-id";
export const E2E_TEST_WORKER_HEADER = "x-leadguard-test-worker-id";

export type HeaderReader = {
  get(name: string): string | null;
};

const isolationToken = /^[A-Za-z0-9._:-]{1,128}$/;

function sanitizeIsolationToken(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !isolationToken.test(trimmed)) return undefined;
  return trimmed;
}

export function isE2eRateLimitIsolationEnabled(
  env: NodeJS.Dict<string> = process.env,
): boolean {
  return env.E2E_RATE_LIMIT_ISOLATION === "true";
}

export function clientIpFromHeaders(headerList: HeaderReader): string {
  const forwarded = headerList.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown"
  );
}

export function clientRateLimitIdentity(
  headerList: HeaderReader,
  env: NodeJS.Dict<string> = process.env,
): string {
  const ip = clientIpFromHeaders(headerList);
  if (!isE2eRateLimitIsolationEnabled(env)) {
    return ip;
  }
  const runId = sanitizeIsolationToken(headerList.get(E2E_TEST_RUN_HEADER));
  if (!runId) return ip;
  const workerId =
    sanitizeIsolationToken(headerList.get(E2E_TEST_WORKER_HEADER)) ?? "0";
  return `test:${runId}:${workerId}`;
}

export function consumeRateLimit(
  key: string,
  limit = 10,
  windowMs = 15 * 60 * 1000,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
    };
  }

  existing.count += 1;
  return { ok: true };
}

export function resetRateLimitStore(): void {
  buckets.clear();
}
