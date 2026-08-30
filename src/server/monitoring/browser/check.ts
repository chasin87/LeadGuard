import { performance } from "node:perf_hooks";
import type {
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
} from "playwright-core";
import type {
  BrowserViewport,
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";
import type { Soft404SignalCode } from "@/server/monitoring/soft404";
import { analyzeSoft404 } from "@/server/monitoring/soft404";
import { UrlValidationError } from "@/server/security/errors";
import {
  assertPublicHttpTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import { createLogger } from "@/server/logger";
import {
  classifyBrowserCheck,
  detectBlankPage,
} from "@/server/monitoring/browser/classify";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import {
  BrowserInfrastructureError,
  isChromiumUnavailableError,
} from "@/server/monitoring/browser/errors";
import { incrementBrowserMetric } from "@/server/monitoring/browser/metrics";
import {
  evaluateBrowserRequest,
  isSsrfDecision,
  type BrowserRequestPolicyOptions,
} from "@/server/monitoring/browser/request-policy";
import {
  sanitizeErrorMessage,
  sanitizeResourceUrl,
} from "@/server/monitoring/browser/sanitize";
import { validateCssSelector } from "@/server/monitoring/browser/selector";
import {
  withIsolatedContext,
  restartBrowser,
} from "@/server/monitoring/browser/session";
import { getBrowserViewportPreset } from "@/server/monitoring/browser/viewports";

const logger = createLogger("browser-worker");

export type BrowserJavascriptError = {
  name: string;
  message: string;
};

export type BrowserFailedResource = {
  url: string;
  resourceType: string;
  status: number | null;
};

export type BrowserCheckDetailInput = {
  viewport: BrowserViewport;
  navigationDurationMs: number | null;
  totalDurationMs: number;
  javascriptErrorCount: number;
  pageErrorCount: number;
  failedResourceCount: number;
  requiredElementFound: boolean | null;
  renderedTextLength: number | null;
  javascriptErrors: BrowserJavascriptError[];
  failedResources: BrowserFailedResource[];
  dialogOccurred: boolean;
  screenshotBuffer: Buffer | null;
};

export type BrowserCheckResult = {
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
  browserDetail: BrowserCheckDetailInput;
};

export type PerformBrowserCheckOptions = {
  timeoutMs: number;
  viewport: BrowserViewport;
  requiredSelector?: string | null;
  requiredElementName?: string | null;
  resolver?: DnsResolver;
  allowPrivateLoopbackForTests?: boolean;
  signal?: AbortSignal;
  captureScreenshot?: boolean;
};

type PageDiagnostics = {
  pageErrors: BrowserJavascriptError[];
  consoleErrors: string[];
  failedResources: BrowserFailedResource[];
  dialogOccurred: boolean;
  pageCrashed: boolean;
  blockedMainDocument: boolean;
};

export async function performBrowserMonitorCheck(
  requestedUrl: string,
  options: PerformBrowserCheckOptions,
): Promise<BrowserCheckResult> {
  const started = performance.now();
  incrementBrowserMetric("browser_checks_total");

  const preflight = await preflightTarget(requestedUrl, options);
  if (preflight) {
    return finalizeResult({
      requestedUrl,
      started,
      viewport: options.viewport,
      classification: {
        status: "FAILURE",
        errorType: preflight.errorType,
        errorMessage: preflight.errorMessage,
      },
      httpStatus: null,
      finalUrl: null,
      resolvedIp: preflight.resolvedIp,
      detail: emptyDetail(
        options.viewport,
        Math.round(performance.now() - started),
      ),
    });
  }

  try {
    return await withIsolatedContext(
      contextOptions(options.viewport),
      async (context) =>
        runIsolatedCheck(context, requestedUrl, options, started),
    );
  } catch (error) {
    if (error instanceof BrowserInfrastructureError) throw error;
    if (isChromiumUnavailableError(error)) {
      throw new BrowserInfrastructureError(
        "Chromium is unavailable. This is a LeadGuard infrastructure problem, not a website outage.",
        { cause: error },
      );
    }
    if (isDisconnectedInfrastructure(error)) {
      await restartBrowser("disconnected").catch(() => undefined);
      throw new BrowserInfrastructureError(
        "The browser worker lost its Chromium process and will retry.",
        { cause: error },
      );
    }
    const totalDurationMs = Math.round(performance.now() - started);
    return finalizeResult({
      requestedUrl,
      started,
      viewport: options.viewport,
      classification: {
        status: "FAILURE",
        errorType: "BROWSER_NAVIGATION_ERROR",
        errorMessage: "The browser could not open this page.",
      },
      httpStatus: null,
      finalUrl: null,
      resolvedIp: null,
      detail: emptyDetail(options.viewport, totalDurationMs),
    });
  }
}

async function runIsolatedCheck(
  context: BrowserContext,
  requestedUrl: string,
  options: PerformBrowserCheckOptions,
  started: number,
): Promise<BrowserCheckResult> {
  const config = getBrowserMonitoringConfig();
  const page = await context.newPage();
  const diagnostics = createDiagnostics();
  const hostnameCache = new Map<
    string,
    Awaited<ReturnType<typeof evaluateBrowserRequest>>
  >();
  const policy: BrowserRequestPolicyOptions = {
    resolver: options.resolver,
    allowPrivateLoopbackForTests: options.allowPrivateLoopbackForTests,
    hostnameDecisionCache: hostnameCache,
  };

  attachPageGuards(page, diagnostics, config.maxConsoleErrors);

  await page.route("**/*", async (route) => {
    const request = route.request();
    const decision = await evaluateBrowserRequest(
      request.url(),
      request.resourceType(),
      policy,
    );
    if (decision === "allow") {
      await route.continue();
      return;
    }
    if (request.isNavigationRequest() && isSsrfDecision(decision)) {
      diagnostics.blockedMainDocument = true;
    }
    await route.abort("blockedbyclient");
  });

  let httpStatus: number | null = null;
  let finalUrl: string | null = null;
  let navigationDurationMs: number | null = null;
  let navigationTimeout = false;
  let navigationError = false;
  let pageCrash = false;
  let browserCrash = false;

  const navigationStarted = performance.now();
  try {
    const response = await page.goto(requestedUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    navigationDurationMs = Math.round(performance.now() - navigationStarted);
    httpStatus = response?.status() ?? null;
    finalUrl = page.url();
    if (diagnostics.blockedMainDocument) {
      navigationError = true;
    }
  } catch (error) {
    navigationDurationMs = Math.round(performance.now() - navigationStarted);
    finalUrl = page.url() === "about:blank" ? null : page.url();
    await sleep(25);
    if (
      diagnostics.blockedMainDocument ||
      isBlockedByClient(error) ||
      isUnsafeNavigationError(error)
    ) {
      diagnostics.blockedMainDocument = true;
    } else if (isTimeoutError(error)) {
      navigationTimeout = true;
    } else if (diagnostics.pageCrashed) {
      pageCrash = true;
    } else if (isDisconnectedInfrastructure(error) && !page.url()) {
      browserCrash = true;
    } else {
      navigationError = true;
    }
  }

  if (
    config.stabilizeMs > 0 &&
    !navigationTimeout &&
    !diagnostics.blockedMainDocument
  ) {
    await sleep(config.stabilizeMs);
  }

  if (diagnostics.pageCrashed) pageCrash = true;

  let invalidSelector = false;
  let requiredElementMissing = false;
  let requiredElementFound: boolean | null = null;
  const required = options.requiredSelector?.trim() || "";
  if (required) {
    const parsed = validateCssSelector(required);
    if (!parsed.ok || !parsed.value) {
      invalidSelector = true;
    } else {
      try {
        const locator = page.locator(parsed.value).first();
        const attached = await locator.count();
        if (attached === 0) {
          requiredElementFound = false;
          requiredElementMissing = true;
        } else {
          const visible = await locator.isVisible();
          requiredElementFound = visible;
          requiredElementMissing = !visible;
        }
      } catch {
        invalidSelector = true;
      }
    }
  }

  const snapshot = await readPageSnapshot(page);
  const blankPage = detectBlankPage({
    renderedTextLength: snapshot.textLength,
    visibleElementCount: snapshot.visibleElementCount,
    bodyHeight: snapshot.bodyHeight,
    pageErrorCount: diagnostics.pageErrors.length,
  });
  const severeJavascriptFailure =
    diagnostics.pageErrors.length >= 3 &&
    snapshot.textLength < 80 &&
    snapshot.visibleElementCount <= 4 &&
    !blankPage;

  let renderedSoft404 = false;
  let soft404Score: number | null = null;
  let soft404ClassifierVersion: string | null = null;
  let soft404Signals: Soft404SignalCode[] | null = null;

  if (
    !diagnostics.blockedMainDocument &&
    !navigationTimeout &&
    (httpStatus == null || (httpStatus >= 200 && httpStatus <= 299))
  ) {
    const analysis = analyzeSoft404({
      httpStatus: httpStatus ?? 200,
      contentType: "text/html; charset=utf-8",
      body: Buffer.from(
        syntheticHtml(snapshot.title, snapshot.h1, snapshot.text),
        "utf8",
      ),
      requestedUrl,
      finalUrl,
    });
    if (analysis.classification === "SOFT_404") {
      renderedSoft404 = true;
      soft404Score = analysis.score;
      soft404ClassifierVersion = analysis.classifierVersion;
      soft404Signals = analysis.signals;
    }
  }

  const totalDurationMs = Math.round(performance.now() - started);
  let classification = classifyBrowserCheck({
    unsafeMainDocument: diagnostics.blockedMainDocument,
    navigationTimeout,
    navigationError: navigationError && !diagnostics.blockedMainDocument,
    browserCrash,
    pageCrash,
    invalidSelector,
    mainHttpStatus: httpStatus,
    renderedSoft404,
    requiredElementMissing,
    blankPage,
    severeJavascriptFailure,
    totalDurationMs,
    degradedLatencyMs: config.degradedLatencyMs,
  });

  if (
    classification.errorType === "REQUIRED_ELEMENT_MISSING" &&
    options.requiredElementName?.trim()
  ) {
    classification = {
      ...classification,
      errorMessage: `Required element missing: ${options.requiredElementName.trim()}`,
    };
  } else if (
    classification.errorType === "REQUIRED_ELEMENT_MISSING" &&
    required
  ) {
    classification = {
      ...classification,
      errorMessage: `Expected page element is no longer visible: ${required}`,
    };
  }

  const shouldScreenshot =
    (options.captureScreenshot ?? true) &&
    classification.status === "FAILURE" &&
    classification.errorType !== "INVALID_MONITOR_CONFIGURATION";

  let screenshotBuffer: Buffer | null = null;
  if (shouldScreenshot && !diagnostics.pageCrashed) {
    try {
      screenshotBuffer = await page.screenshot({
        type: "jpeg",
        quality: config.screenshotQuality,
        fullPage: false,
        timeout: 5_000,
      });
      if (screenshotBuffer.byteLength > config.maxScreenshotBytes) {
        screenshotBuffer = null;
      } else {
        incrementBrowserMetric("browser_screenshots_captured");
        logger.info("browser.screenshot.captured", {
          viewport: options.viewport,
        });
      }
    } catch (error) {
      logger.warn("browser.screenshot.failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (classification.errorType === "REQUIRED_ELEMENT_MISSING") {
    logger.info("browser.required_element.missing", {
      selectorLength: required.length,
    });
  }
  if (renderedSoft404) {
    logger.info("browser.soft404.detected", {
      score: soft404Score ?? 0,
    });
  }
  if (diagnostics.pageErrors.length > 0) {
    logger.info("browser.pageerror.detected", {
      count: diagnostics.pageErrors.length,
    });
  }

  await page.close().catch(() => undefined);

  return finalizeResult({
    requestedUrl,
    started,
    viewport: options.viewport,
    classification,
    httpStatus,
    finalUrl,
    resolvedIp: null,
    soft404Score,
    soft404ClassifierVersion,
    soft404Signals,
    detail: {
      viewport: options.viewport,
      navigationDurationMs,
      totalDurationMs,
      javascriptErrorCount:
        diagnostics.pageErrors.length + diagnostics.consoleErrors.length,
      pageErrorCount: diagnostics.pageErrors.length,
      failedResourceCount: diagnostics.failedResources.length,
      requiredElementFound,
      renderedTextLength: snapshot.textLength,
      javascriptErrors: diagnostics.pageErrors.slice(
        0,
        config.maxJavascriptErrors,
      ),
      failedResources: diagnostics.failedResources.slice(
        0,
        config.maxFailedResources,
      ),
      dialogOccurred: diagnostics.dialogOccurred,
      screenshotBuffer,
    },
  });
}

async function preflightTarget(
  requestedUrl: string,
  options: PerformBrowserCheckOptions,
): Promise<{
  errorType: MonitorCheckErrorType;
  errorMessage: string;
  resolvedIp: string | null;
} | null> {
  if (options.allowPrivateLoopbackForTests) {
    try {
      const url = new URL(requestedUrl);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
        return null;
      }
    } catch {
      return {
        errorType: "UNSAFE_TARGET",
        errorMessage:
          "Private and internal network addresses cannot be monitored.",
        resolvedIp: null,
      };
    }
  }
  try {
    await assertPublicHttpTarget(requestedUrl, {
      resolver: options.resolver,
      originOnly: false,
    });
    return null;
  } catch (error) {
    if (error instanceof UrlValidationError) {
      if (error.reason === "dns_failed") {
        return {
          errorType: "DNS_ERROR",
          errorMessage: "DNS lookup failed.",
          resolvedIp: null,
        };
      }
      return {
        errorType: "UNSAFE_TARGET",
        errorMessage:
          "Private and internal network addresses cannot be monitored.",
        resolvedIp: null,
      };
    }
    throw error;
  }
}

function contextOptions(viewport: BrowserViewport) {
  const preset = getBrowserViewportPreset(viewport);
  return {
    viewport: { width: preset.width, height: preset.height },
    userAgent: preset.userAgent,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
    locale: "en-US",
    extraHTTPHeaders: {},
  };
}

function createDiagnostics(): PageDiagnostics {
  return {
    pageErrors: [],
    consoleErrors: [],
    failedResources: [],
    dialogOccurred: false,
    pageCrashed: false,
    blockedMainDocument: false,
  };
}

function attachPageGuards(
  page: Page,
  diagnostics: PageDiagnostics,
  maxConsoleErrors: number,
): void {
  page.on("pageerror", (error) => {
    if (diagnostics.pageErrors.length >= 10) return;
    diagnostics.pageErrors.push({
      name: error.name || "Error",
      message: sanitizeErrorMessage(error.message),
    });
  });
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    if (diagnostics.consoleErrors.length >= maxConsoleErrors) return;
    diagnostics.consoleErrors.push(sanitizeErrorMessage(message.text()));
  });
  page.on("requestfailed", (request: Request) => {
    const type = request.resourceType();
    if (!["document", "script", "stylesheet", "xhr", "fetch"].includes(type)) {
      return;
    }
    if (diagnostics.failedResources.length >= 8) return;
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_BLOCKED_BY_CLIENT") return;
    diagnostics.failedResources.push({
      url: sanitizeResourceUrl(request.url()),
      resourceType: type,
      status: null,
    });
  });
  page.on("crash", () => {
    diagnostics.pageCrashed = true;
  });
  page.on("dialog", (dialog) => {
    diagnostics.dialogOccurred = true;
    void dialog.dismiss();
  });
  page.on("popup", (popup) => {
    void popup.close();
  });
  page.on("download", (download) => {
    void download.cancel();
  });
}

async function readPageSnapshot(page: Page): Promise<{
  title: string;
  h1: string;
  text: string;
  textLength: number;
  visibleElementCount: number;
  bodyHeight: number;
}> {
  try {
    return await page.evaluate(() => {
      const body = document.body;
      const text = (body?.innerText ?? "").replace(/\s+/g, " ").trim();
      const visible = body
        ? Array.from(body.querySelectorAll("*")).filter((node) => {
            const el = node as HTMLElement;
            const style = window.getComputedStyle(el);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              el.getClientRects().length > 0
            );
          }).length
        : 0;
      return {
        title: document.title ?? "",
        h1: document.querySelector("h1")?.textContent?.trim() ?? "",
        text,
        textLength: text.length,
        visibleElementCount: visible,
        bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
      };
    });
  } catch {
    return {
      title: "",
      h1: "",
      text: "",
      textLength: 0,
      visibleElementCount: 0,
      bodyHeight: 0,
    };
  }
}

function syntheticHtml(title: string, h1: string, text: string): string {
  return `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(h1)}</h1><p>${escapeHtml(text.slice(0, 20_000))}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emptyDetail(
  viewport: BrowserViewport,
  totalDurationMs: number,
): BrowserCheckDetailInput {
  return {
    viewport,
    navigationDurationMs: null,
    totalDurationMs,
    javascriptErrorCount: 0,
    pageErrorCount: 0,
    failedResourceCount: 0,
    requiredElementFound: null,
    renderedTextLength: null,
    javascriptErrors: [],
    failedResources: [],
    dialogOccurred: false,
    screenshotBuffer: null,
  };
}

function finalizeResult(input: {
  requestedUrl: string;
  started: number;
  viewport: BrowserViewport;
  classification: {
    status: MonitorCheckStatus;
    errorType: MonitorCheckErrorType | null;
    errorMessage: string | null;
  };
  httpStatus: number | null;
  finalUrl: string | null;
  resolvedIp: string | null;
  soft404Score?: number | null;
  soft404ClassifierVersion?: string | null;
  soft404Signals?: Soft404SignalCode[] | null;
  detail: BrowserCheckDetailInput;
}): BrowserCheckResult {
  if (input.classification.status === "FAILURE") {
    incrementBrowserMetric("browser_check_failures");
  }
  incrementBrowserMetric(
    "browser_check_duration_ms_sum",
    input.detail.totalDurationMs,
  );
  return {
    status: input.classification.status,
    httpStatus: input.httpStatus,
    responseTimeMs:
      input.detail.navigationDurationMs ?? input.detail.totalDurationMs,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    redirectCount: 0,
    resolvedIp: input.resolvedIp,
    errorType: input.classification.errorType,
    errorMessage: input.classification.errorMessage,
    soft404Score: input.soft404Score ?? null,
    soft404ClassifierVersion: input.soft404ClassifierVersion ?? null,
    soft404Signals: input.soft404Signals ?? null,
    browserDetail: input.detail,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isUnsafeNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /169\.254|ERR_BLOCKED_BY_CLIENT|ERR_UNSAFE_REDIRECT|ERR_INVALID_REDIRECT|ERR_BLOCKED_BY_PRIVATE_NETWORK|ERR_ADDRESS_INVALID/i.test(
    message,
  );
}

function isBlockedByClient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_BLOCKED_BY_CLIENT|net::ERR_ABORTED/i.test(message);
}

function isTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "TimeoutError" || /timeout/i.test(message);
}

function isDisconnectedInfrastructure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /has been closed/i.test(message) ||
    /Target closed/i.test(message) ||
    /browser has been closed/i.test(message) ||
    /Connection closed/i.test(message)
  );
}
