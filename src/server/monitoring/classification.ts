import type {
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";

export const degradedLatencyMs = 5_000;

export type ClassifiedHttpResult = {
  status: MonitorCheckStatus;
  errorType: MonitorCheckErrorType | null;
  errorMessage: string | null;
};

export function classifyHttpStatus(
  httpStatus: number,
  responseTimeMs: number,
  latencyThresholdMs = degradedLatencyMs,
): ClassifiedHttpResult {
  if (httpStatus >= 200 && httpStatus <= 299) {
    if (responseTimeMs > latencyThresholdMs) {
      return {
        status: "DEGRADED",
        errorType: null,
        errorMessage: "Response was successful but slower than expected.",
      };
    }
    return { status: "SUCCESS", errorType: null, errorMessage: null };
  }

  if (httpStatus === 404) {
    return {
      status: "FAILURE",
      errorType: "HTTP_404",
      errorMessage: "The page returned HTTP 404.",
    };
  }
  if (httpStatus === 401) {
    return {
      status: "FAILURE",
      errorType: "HTTP_401",
      errorMessage: "The page returned HTTP 401.",
    };
  }
  if (httpStatus === 403) {
    return {
      status: "FAILURE",
      errorType: "HTTP_403",
      errorMessage: "The page returned HTTP 403.",
    };
  }
  if (httpStatus === 429) {
    return {
      status: "FAILURE",
      errorType: "HTTP_429",
      errorMessage: "The page returned HTTP 429.",
    };
  }
  if (httpStatus >= 400 && httpStatus <= 499) {
    return {
      status: "FAILURE",
      errorType: "HTTP_4XX",
      errorMessage: `The page returned HTTP ${httpStatus}.`,
    };
  }
  if (httpStatus >= 500 && httpStatus <= 599) {
    return {
      status: "FAILURE",
      errorType: "HTTP_5XX",
      errorMessage: `The page returned HTTP ${httpStatus}.`,
    };
  }

  return {
    status: "FAILURE",
    errorType: "INVALID_RESPONSE",
    errorMessage: `Unexpected HTTP status ${httpStatus}.`,
  };
}

export const SOFT_404_ERROR_MESSAGE =
  "The page appears to be a not-found page despite returning HTTP 200.";

export function classifySoft404Failure(): ClassifiedHttpResult {
  return {
    status: "FAILURE",
    errorType: "SOFT_404",
    errorMessage: SOFT_404_ERROR_MESSAGE,
  };
}

export function isRedirectStatus(httpStatus: number): boolean {
  return (
    httpStatus === 301 ||
    httpStatus === 302 ||
    httpStatus === 303 ||
    httpStatus === 307 ||
    httpStatus === 308
  );
}
