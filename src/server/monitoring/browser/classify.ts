import type {
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";

export type BrowserClassificationInput = {
  unsafeMainDocument: boolean;
  navigationTimeout: boolean;
  navigationError: boolean;
  browserCrash: boolean;
  pageCrash: boolean;
  invalidSelector: boolean;
  mainHttpStatus: number | null;
  renderedSoft404: boolean;
  requiredElementMissing: boolean;
  blankPage: boolean;
  severeJavascriptFailure: boolean;
  totalDurationMs: number;
  degradedLatencyMs: number;
};

export type BrowserClassification = {
  status: MonitorCheckStatus;
  errorType: MonitorCheckErrorType | null;
  errorMessage: string | null;
};

/**
 * Precedence (highest first):
 * unsafe main document
 * > navigation timeout / navigation error
 * > browser or page crash
 * > invalid monitor configuration
 * > main-document HTTP failure
 * > rendered soft-404
 * > required element missing
 * > blank page
 * > severe JS + broken page
 * > slow but usable (DEGRADED)
 * > success
 *
 * A full-page rendered soft-404 wins over a missing required element.
 * Console/page errors alone never open an outage.
 */
export function classifyBrowserCheck(
  input: BrowserClassificationInput,
): BrowserClassification {
  if (input.unsafeMainDocument) {
    return {
      status: "FAILURE",
      errorType: "UNSAFE_BROWSER_REQUEST",
      errorMessage:
        "The page tried to navigate to an address that cannot be monitored.",
    };
  }
  if (input.navigationTimeout) {
    return {
      status: "FAILURE",
      errorType: "BROWSER_TIMEOUT",
      errorMessage: "The page did not finish loading in time.",
    };
  }
  if (input.browserCrash) {
    return {
      status: "FAILURE",
      errorType: "BROWSER_CRASH",
      errorMessage: "The browser process crashed while loading this page.",
    };
  }
  if (input.pageCrash) {
    return {
      status: "FAILURE",
      errorType: "PAGE_CRASH",
      errorMessage: "The page crashed while rendering.",
    };
  }
  if (input.navigationError) {
    return {
      status: "FAILURE",
      errorType: "BROWSER_NAVIGATION_ERROR",
      errorMessage: "The browser could not open this page.",
    };
  }
  if (input.invalidSelector) {
    return {
      status: "FAILURE",
      errorType: "INVALID_MONITOR_CONFIGURATION",
      errorMessage: "Monitor configuration is invalid.",
    };
  }

  if (input.mainHttpStatus != null && input.mainHttpStatus >= 400) {
    return httpStatusFailure(input.mainHttpStatus);
  }

  if (input.renderedSoft404) {
    return {
      status: "FAILURE",
      errorType: "SOFT_404",
      errorMessage:
        "The page appears to be a not-found page despite returning HTTP 200.",
    };
  }
  if (input.requiredElementMissing) {
    return {
      status: "FAILURE",
      errorType: "REQUIRED_ELEMENT_MISSING",
      errorMessage: "Expected page element is no longer visible.",
    };
  }
  if (input.blankPage) {
    return {
      status: "FAILURE",
      errorType: "CONTENT_NOT_RENDERED",
      errorMessage: "The page loaded but did not render usable content.",
    };
  }
  if (input.severeJavascriptFailure) {
    return {
      status: "FAILURE",
      errorType: "TOO_MANY_BROWSER_ERRORS",
      errorMessage:
        "The page reported severe JavaScript errors and did not render correctly.",
    };
  }
  if (input.totalDurationMs > input.degradedLatencyMs) {
    return {
      status: "DEGRADED",
      errorType: null,
      errorMessage: "The page rendered successfully but slower than expected.",
    };
  }
  return { status: "SUCCESS", errorType: null, errorMessage: null };
}

function httpStatusFailure(httpStatus: number): BrowserClassification {
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

export function isIncidentEligibleBrowserError(
  errorType: MonitorCheckErrorType | null,
): boolean {
  return errorType !== "INVALID_MONITOR_CONFIGURATION";
}

export type BlankPageSignals = {
  renderedTextLength: number;
  visibleElementCount: number;
  bodyHeight: number;
  pageErrorCount: number;
};

/**
 * Conservative blank-page detection. A legitimate sparse landing page should
 * not fail. Require a near-empty body plus at least one corroborating signal.
 */
export function detectBlankPage(signals: BlankPageSignals): boolean {
  const nearlyEmptyText = signals.renderedTextLength < 12;
  const fewNodes = signals.visibleElementCount <= 2;
  const tinyBody = signals.bodyHeight < 40;
  const hadRuntimeError = signals.pageErrorCount > 0;
  if (!nearlyEmptyText || !fewNodes) return false;
  return tinyBody || hadRuntimeError;
}
