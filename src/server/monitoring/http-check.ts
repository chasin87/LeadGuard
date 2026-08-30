import { performance } from "node:perf_hooks";
import type {
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";
import { parseHttpUrlInput } from "@/lib/urls/normalize-url";
import {
  classifyHttpStatus,
  classifySoft404Failure,
  isRedirectStatus,
} from "@/server/monitoring/classification";
import { getMonitoringConfig } from "@/server/monitoring/config";
import {
  mapNetworkError,
  mapUrlValidationError,
} from "@/server/monitoring/error-mapping";
import {
  defaultPinnedTransport,
  type PinnedHttpTransport,
} from "@/server/monitoring/pinned-transport";
import { UrlValidationError } from "@/server/security/errors";
import {
  assertPublicHttpTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import { createLogger } from "@/server/logger";
import { analyzeSoft404 } from "@/server/monitoring/soft404";
import type { Soft404SignalCode } from "@/server/monitoring/soft404";

const logger = createLogger("monitor-worker");

export type HttpCheckResult = {
  status: MonitorCheckStatus;
  httpStatus: number | null;
  responseTimeMs: number;
  requestedUrl: string;
  finalUrl: string | null;
  redirectCount: number;
  resolvedIp: string | null;
  errorType: MonitorCheckErrorType | null;
  errorMessage: string | null;
  soft404Score?: number | null;
  soft404ClassifierVersion?: string | null;
  soft404Signals?: Soft404SignalCode[] | null;
};

export type PerformHttpCheckOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: DnsResolver;
  transport?: PinnedHttpTransport;
  userAgent?: string;
  degradedLatencyMs?: number;
  signal?: AbortSignal;
};

function headerValue(
  headers: Record<string, unknown>,
  name: string,
): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

function locationHeader(headers: Record<string, unknown>): string | null {
  return headerValue(headers, "location");
}

function pickResolvedIp(addresses: string[]): string {
  const ipv4 = addresses.find((address) => !address.includes(":"));
  return ipv4 ?? addresses[0] ?? "";
}

function fail(
  partial: Omit<HttpCheckResult, "status"> & {
    status?: MonitorCheckStatus;
  },
): HttpCheckResult {
  return {
    status: "FAILURE",
    ...partial,
  };
}

function analyzeSuccessfulResponse(input: {
  classified: ReturnType<typeof classifyHttpStatus>;
  httpStatus: number;
  contentType: string | null;
  contentEncoding: string | null;
  body: Buffer;
  requestedUrl: string;
  finalUrl: string;
}): {
  status: MonitorCheckStatus;
  errorType: MonitorCheckErrorType | null;
  errorMessage: string | null;
  soft404Score: number | null;
  soft404ClassifierVersion: string | null;
  soft404Signals: Soft404SignalCode[] | null;
} {
  if (input.classified.status === "FAILURE") {
    return {
      ...input.classified,
      soft404Score: null,
      soft404ClassifierVersion: null,
      soft404Signals: null,
    };
  }

  try {
    const analysis = analyzeSoft404(
      {
        httpStatus: input.httpStatus,
        contentType: input.contentType,
        body: input.body,
        requestedUrl: input.requestedUrl,
        finalUrl: input.finalUrl,
      },
      input.contentEncoding,
    );
    if (!analysis.analyzed) {
      return {
        ...input.classified,
        soft404Score: null,
        soft404ClassifierVersion: null,
        soft404Signals: null,
      };
    }
    if (analysis.classification === "SOFT_404") {
      const failure = classifySoft404Failure();
      return {
        ...failure,
        soft404Score: analysis.score,
        soft404ClassifierVersion: analysis.classifierVersion,
        soft404Signals: analysis.signals,
      };
    }
    return {
      ...input.classified,
      soft404Score: analysis.score,
      soft404ClassifierVersion: analysis.classifierVersion,
      soft404Signals: analysis.signals,
    };
  } catch {
    logger.warn("soft404.analysis.failed", {
      requestedUrl: input.requestedUrl,
    });
    return {
      ...input.classified,
      soft404Score: null,
      soft404ClassifierVersion: null,
      soft404Signals: null,
    };
  }
}

export async function performHttpMonitorCheck(
  requestedUrl: string,
  options: PerformHttpCheckOptions = {},
): Promise<HttpCheckResult> {
  const config = getMonitoringConfig();
  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs;
  const maxRedirects = options.maxRedirects ?? config.maxRedirects;
  const transport = options.transport ?? defaultPinnedTransport;
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onParentAbort);

  const elapsed = () => Math.max(1, Math.round(performance.now() - started));

  try {
    let currentUrl = parseHttpUrlInput(requestedUrl).normalizedUrl;
    const visited = new Set<string>([currentUrl]);
    let redirectCount = 0;
    let lastIp: string | null = null;

    while (true) {
      if (controller.signal.aborted) {
        return fail({
          httpStatus: null,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: lastIp,
          errorType: "TIMEOUT",
          errorMessage: "The request timed out.",
        });
      }

      let target;
      try {
        target = await assertPublicHttpTarget(currentUrl, {
          resolver: options.resolver,
        });
      } catch (error) {
        const mapped =
          error instanceof UrlValidationError
            ? mapUrlValidationError(
                error,
                redirectCount > 0 ? "redirect" : "target",
              )
            : mapNetworkError(error);
        return fail({
          httpStatus: null,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: lastIp,
          errorType: mapped.errorType,
          errorMessage: mapped.errorMessage,
        });
      }

      const ip = pickResolvedIp(target.resolvedAddresses);
      lastIp = ip || lastIp;
      if (!ip) {
        return fail({
          httpStatus: null,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: lastIp,
          errorType: "DNS_ERROR",
          errorMessage: "DNS lookup failed.",
        });
      }

      let response;
      try {
        response = await transport({
          url: new URL(currentUrl),
          ip,
          headers: {
            "User-Agent": options.userAgent ?? config.userAgent,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en,nl;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "close",
          },
          timeoutMs,
          maxBodyBytes: config.maxResponseBytes,
          signal: controller.signal,
        });
      } catch (error) {
        const mapped = controller.signal.aborted
          ? {
              errorType: "TIMEOUT" as const,
              errorMessage: "The request timed out.",
            }
          : mapNetworkError(error);
        return fail({
          httpStatus: null,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: ip,
          errorType: mapped.errorType,
          errorMessage: mapped.errorMessage,
        });
      }

      if (!isRedirectStatus(response.statusCode)) {
        const classified = classifyHttpStatus(
          response.statusCode,
          elapsed(),
          options.degradedLatencyMs ?? config.degradedLatencyMs,
        );
        const headers = response.headers as Record<string, unknown>;
        const soft404 = analyzeSuccessfulResponse({
          classified,
          httpStatus: response.statusCode,
          contentType: headerValue(headers, "content-type"),
          contentEncoding: headerValue(headers, "content-encoding"),
          body: response.body ?? Buffer.alloc(0),
          requestedUrl,
          finalUrl: currentUrl,
        });
        return {
          status: soft404.status,
          httpStatus: response.statusCode,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: ip,
          errorType: soft404.errorType,
          errorMessage: soft404.errorMessage,
          soft404Score: soft404.soft404Score,
          soft404ClassifierVersion: soft404.soft404ClassifierVersion,
          soft404Signals: soft404.soft404Signals,
        };
      }

      const location = locationHeader(
        response.headers as Record<string, unknown>,
      );
      if (!location) {
        return fail({
          httpStatus: response.statusCode,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: ip,
          errorType: "INVALID_RESPONSE",
          errorMessage:
            "The redirect response did not include a Location header.",
        });
      }

      let nextUrl: string;
      try {
        nextUrl = parseHttpUrlInput(
          new URL(location, currentUrl).href,
        ).normalizedUrl;
      } catch (error) {
        const mapped =
          error instanceof UrlValidationError
            ? mapUrlValidationError(error, "redirect")
            : mapNetworkError(error);
        return fail({
          httpStatus: response.statusCode,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: ip,
          errorType: mapped.errorType,
          errorMessage: mapped.errorMessage,
        });
      }

      redirectCount += 1;
      if (redirectCount > maxRedirects) {
        return fail({
          httpStatus: response.statusCode,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          resolvedIp: ip,
          errorType: "TOO_MANY_REDIRECTS",
          errorMessage: "Too many redirects.",
        });
      }
      if (visited.has(nextUrl)) {
        return fail({
          httpStatus: response.statusCode,
          responseTimeMs: elapsed(),
          requestedUrl,
          finalUrl: nextUrl,
          redirectCount,
          resolvedIp: ip,
          errorType: "REDIRECT_LOOP",
          errorMessage: "The redirect loop was stopped.",
        });
      }
      visited.add(nextUrl);
      currentUrl = nextUrl;
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onParentAbort);
  }
}
