import { performance } from "node:perf_hooks";
import type { BrowserContext, Locator, Page } from "playwright-core";
import type {
  FormSubmissionState,
  MonitorCheckErrorType,
} from "@/generated/prisma/enums";
import { UrlValidationError } from "@/server/security/errors";
import {
  assertPublicHttpTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import { createLogger } from "@/server/logger";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import {
  BrowserInfrastructureError,
  isChromiumUnavailableError,
} from "@/server/monitoring/browser/errors";
import {
  evaluateBrowserRequest,
  isSsrfDecision,
  type BrowserRequestPolicyOptions,
} from "@/server/monitoring/browser/request-policy";
import { validateCssSelector } from "@/server/monitoring/browser/selector";
import {
  restartBrowser,
  withIsolatedContext,
} from "@/server/monitoring/browser/session";
import { getBrowserViewportPreset } from "@/server/monitoring/browser/viewports";
import { detectCaptcha } from "@/server/monitoring/form/captcha";
import { classifyFormCheck } from "@/server/monitoring/form/classify";
import {
  collectValidationMessages,
  discoverPageCounts,
  findUnmappedRequiredFields,
  locatorState,
  readVisibleText,
  scopedForm,
} from "@/server/monitoring/form/inspect";
import {
  attachFormNetworkObserver,
  selectSubmitRequest,
} from "@/server/monitoring/form/network";
import {
  formContainsPassword,
  formContainsPaymentFields,
  formContainsRequiredFileInput,
} from "@/server/monitoring/form/sensitive";
import {
  matchSuccessUrl,
  visibleTextContains,
} from "@/server/monitoring/form/success";
import type {
  FormCheckResult,
  FormFieldMapping,
  FormMonitorRuntimeConfig,
  FormValidationSnapshot,
} from "@/server/monitoring/form/types";
import type { ResolvedFieldValue } from "@/server/monitoring/form/test-data";

const logger = createLogger("form-worker");

export type PerformFormCheckOptions = {
  timeoutMs: number;
  config: FormMonitorRuntimeConfig;
  values: ResolvedFieldValue[];
  mappings: FormFieldMapping[];
  submissionId: string;
  resolver?: DnsResolver;
  allowPrivateLoopbackForTests?: boolean;
  signal?: AbortSignal;
  onBeforeSubmit?: () => Promise<void>;
};

export async function performFormMonitorCheck(
  requestedUrl: string,
  options: PerformFormCheckOptions,
): Promise<FormCheckResult> {
  const started = performance.now();
  const preflight = await preflightTarget(requestedUrl, options);
  if (preflight) {
    return emptyFailure(requestedUrl, started, options, {
      errorType: preflight.errorType,
      errorMessage: preflight.errorMessage,
      submissionState: "FAILED",
    });
  }

  try {
    return await withIsolatedContext(
      contextOptions(options.config.viewport),
      async (context) => runFormCheck(context, requestedUrl, options, started),
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
    return emptyFailure(requestedUrl, started, options, {
      errorType: "BROWSER_NAVIGATION_ERROR",
      errorMessage: "The browser could not open this page.",
      submissionState: "FAILED",
    });
  }
}

export async function performFormConfigurationValidation(
  requestedUrl: string,
  options: Omit<
    PerformFormCheckOptions,
    "values" | "submissionId" | "onBeforeSubmit"
  >,
): Promise<FormValidationSnapshot> {
  const preflight = await preflightTarget(requestedUrl, options);
  if (preflight) {
    return {
      ok: false,
      formFound: false,
      submitFound: false,
      submitVisible: false,
      submitEnabled: false,
      successConfigured: successConfigured(options.config),
      captchaDetected: false,
      passwordDetected: false,
      paymentDetected: false,
      fileInputDetected: false,
      fields: [],
      unmappedRequired: [],
      discovered: { forms: 0, inputs: 0, buttons: 0 },
      issues: [{ code: "navigation", message: preflight.errorMessage }],
      validatedAt: new Date().toISOString(),
    };
  }

  return withIsolatedContext(
    contextOptions(options.config.viewport),
    async (context) => {
      const page = await context.newPage();
      await attachRouting(page, options);
      try {
        await page.goto(requestedUrl, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs,
        });
        await sleep(getBrowserMonitoringConfig().stabilizeMs);
        return inspectConfiguration(page, options.config, options.mappings);
      } finally {
        await page.close().catch(() => undefined);
      }
    },
  );
}

async function runFormCheck(
  context: BrowserContext,
  requestedUrl: string,
  options: PerformFormCheckOptions,
  started: number,
): Promise<FormCheckResult> {
  const page = await context.newPage();
  const diagnostics = { blockedMainDocument: false, pageCrashed: false };
  page.on("crash", () => {
    diagnostics.pageCrashed = true;
  });
  page.on("dialog", (dialog) => {
    void dialog.dismiss();
  });
  page.on("popup", (popup) => {
    void popup.close();
  });
  page.on("download", (download) => {
    void download.cancel();
  });

  await attachRouting(page, options, diagnostics);

  let httpStatus: number | null = null;
  let finalUrl: string | null = null;
  let navigationTimeout = false;
  let navigationError = false;
  let pageCrash = false;
  let browserCrash = false;

  try {
    const response = await page.goto(requestedUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    httpStatus = response?.status() ?? null;
    finalUrl = page.url();
    if (diagnostics.blockedMainDocument) navigationError = true;
  } catch (error) {
    finalUrl = page.url() === "about:blank" ? null : page.url();
    if (diagnostics.blockedMainDocument || isBlockedByClient(error)) {
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

  await sleep(getBrowserMonitoringConfig().stabilizeMs);
  if (diagnostics.pageCrashed) pageCrash = true;

  const selectorError = invalidSelectors(options.config, options.mappings);
  let captchaDetected = false;
  let unsupportedFormType = false;
  let unsupportedFormTypeMessage: string | undefined;
  let formFound = false;
  let submitFound = false;
  let submitVisible = false;
  let submitEnabled = false;
  let missingFieldSelector: string | null = null;
  let unmappedRequired: string[] = [];
  let notInteractableSelector: string | null = null;
  let optionMissingSelector: string | null = null;
  let validationErrors: Array<{ selector: string; message: string }> = [];
  let submitHttpStatus: number | null = null;
  let submitEndpointPath: string | null = null;
  let submitMethod: string | null = null;
  let submitClicked = false;
  let successConfirmed = false;
  let submissionTimedOut = false;
  let unexpectedNavigation = false;
  let fieldsFoundCount = 0;
  let submissionState: FormSubmissionState = "PREPARED";
  let submissionDurationMs: number | null = null;
  let screenshotBuffer: Buffer | null = null;

  if (
    !selectorError &&
    !navigationTimeout &&
    !navigationError &&
    !pageCrash &&
    !browserCrash &&
    !diagnostics.blockedMainDocument &&
    (httpStatus == null || httpStatus < 400)
  ) {
    if (options.config.cookieAcceptSelector) {
      const cookie = page.locator(options.config.cookieAcceptSelector).first();
      const cookieState = await locatorState(cookie);
      if (cookieState.visible && cookieState.enabled) {
        await cookie.click({ timeout: 3_000 }).catch(() => undefined);
        await sleep(300);
      }
    }

    captchaDetected = await detectCaptcha(page);
    const form = await scopedForm(page, options.config.formSelector);
    const formState = await locatorState(form);
    formFound = formState.count > 0 && formState.visible;

    if (formFound) {
      if (await formContainsPassword(form)) {
        unsupportedFormType = true;
        unsupportedFormTypeMessage =
          "Login forms with password fields cannot be tested.";
      } else if (await formContainsPaymentFields(form)) {
        unsupportedFormType = true;
        unsupportedFormTypeMessage =
          "Payment and checkout forms cannot be tested.";
      } else if (await formContainsRequiredFileInput(form)) {
        unsupportedFormType = true;
        unsupportedFormTypeMessage =
          "Forms with a required file upload cannot be tested yet.";
      }
    }

    const submit = form.locator(options.config.submitSelector).first();
    const submitState = await locatorState(submit);
    submitFound = submitState.count > 0;
    submitVisible = submitState.visible;
    submitEnabled = submitState.enabled;

    for (const mapping of options.mappings) {
      const field = form.locator(mapping.selector).first();
      const state = await locatorState(field);
      if (state.count === 0) {
        missingFieldSelector = mapping.selector;
        break;
      }
      if (state.visible) fieldsFoundCount += 1;
    }

    if (
      formFound &&
      !missingFieldSelector &&
      !unsupportedFormType &&
      !captchaDetected
    ) {
      unmappedRequired = await findUnmappedRequiredFields(
        form,
        options.mappings,
      );
    }

    if (
      formFound &&
      !captchaDetected &&
      !unsupportedFormType &&
      !missingFieldSelector &&
      unmappedRequired.length === 0
    ) {
      const filled = await fillMappedFields(form, options.values);
      notInteractableSelector = filled.notInteractable;
      optionMissingSelector = filled.optionMissing;
    }

    if (
      formFound &&
      submitFound &&
      submitVisible &&
      submitEnabled &&
      !captchaDetected &&
      !unsupportedFormType &&
      !missingFieldSelector &&
      unmappedRequired.length === 0 &&
      !notInteractableSelector &&
      !optionMissingSelector
    ) {
      const origin = new URL(page.url()).origin;
      const observer = attachFormNetworkObserver(page, origin);
      try {
        if (options.onBeforeSubmit) {
          await options.onBeforeSubmit();
        }
        submissionState = "SUBMITTING";
        const clickedAt = Date.now();
        const submitStarted = performance.now();
        await submit.click({ timeout: 5_000, noWaitAfter: true });
        submitClicked = true;
        submissionState = "SUBMITTED";

        const outcome = await waitForSuccess(
          page,
          options.config,
          options.config.submissionTimeoutMs,
        );
        submissionDurationMs = Math.round(performance.now() - submitStarted);
        successConfirmed = outcome.success;
        submissionTimedOut = outcome.timedOut;
        unexpectedNavigation = outcome.unexpectedNavigation;
        finalUrl = page.url();

        const submitRequest = selectSubmitRequest(observer.requests, clickedAt);
        submitHttpStatus = submitRequest?.status ?? null;
        submitEndpointPath = submitRequest?.path ?? null;
        submitMethod = submitRequest?.method ?? null;
        if (submitRequest) {
          logger.info("form.submit.request_observed", {
            method: submitRequest.method,
            status: submitRequest.status,
          });
        }

        if (!successConfirmed) {
          validationErrors = await collectValidationMessages(form);
        }
        if (successConfirmed) submissionState = "CONFIRMED";
        else if (diagnostics.pageCrashed) {
          submissionState = "AMBIGUOUS";
          pageCrash = true;
        } else {
          submissionState = "FAILED";
        }
      } catch (error) {
        if (submissionState === "SUBMITTING" || submitClicked) {
          submissionState = "AMBIGUOUS";
          logger.warn("form.submit.ambiguous", {
            message: error instanceof Error ? error.message : "unknown",
          });
        } else if (isDisconnectedInfrastructure(error)) {
          throw new BrowserInfrastructureError(
            "The browser worker lost its Chromium process and will retry.",
            { cause: error },
          );
        } else {
          notInteractableSelector = options.config.submitSelector;
        }
      } finally {
        observer.dispose();
      }
    }
  }

  const classification = classifyFormCheck({
    unsafeMainDocument: diagnostics.blockedMainDocument,
    navigationTimeout,
    navigationError,
    browserCrash,
    pageCrash,
    invalidConfiguration: Boolean(selectorError),
    invalidConfigurationMessage: selectorError ?? undefined,
    captchaDetected,
    unsupportedFormType,
    unsupportedFormTypeMessage,
    mainHttpStatus: httpStatus,
    formFound,
    submitFound,
    submitVisible,
    submitEnabled,
    missingFieldSelector,
    unmappedRequired,
    notInteractableSelector,
    optionMissingSelector,
    validationErrors,
    submitHttpStatus,
    submitClicked,
    successConfirmed,
    submissionTimedOut,
    unexpectedNavigation,
    ambiguous: submissionState === "AMBIGUOUS",
  });

  const shouldScreenshot =
    classification.status === "FAILURE" &&
    classification.errorType !== "INVALID_MONITOR_CONFIGURATION" &&
    !diagnostics.pageCrashed;
  if (shouldScreenshot) {
    screenshotBuffer = await captureScreenshot(page);
  }

  logger.info("form.check.completed", {
    status: classification.status,
    errorType: classification.errorType,
    submitClicked,
    successConfirmed,
    captchaDetected,
  });

  await page.close().catch(() => undefined);

  return {
    status: classification.status,
    httpStatus,
    responseTimeMs: Math.round(performance.now() - started),
    requestedUrl,
    finalUrl,
    redirectCount: 0,
    resolvedIp: null,
    errorType: classification.errorType,
    errorMessage: classification.errorMessage,
    formDetail: {
      submissionId: options.submissionId,
      submissionState:
        classification.status === "SUCCESS" ? "CONFIRMED" : submissionState,
      successConfirmed,
      submissionDurationMs,
      submitHttpStatus,
      submitEndpointPath,
      submitMethod,
      fieldsExpectedCount: options.mappings.length,
      fieldsFoundCount,
      formFound,
      submitClicked,
      captchaDetected,
      validationErrors: validationErrors.length > 0 ? validationErrors : null,
      unmappedRequiredFields:
        unmappedRequired.length > 0 ? unmappedRequired : null,
      screenshotBuffer,
    },
  };
}

async function inspectConfiguration(
  page: Page,
  config: FormMonitorRuntimeConfig,
  mappings: FormFieldMapping[],
): Promise<FormValidationSnapshot> {
  const issues: FormValidationSnapshot["issues"] = [];
  const selectorError = invalidSelectors(config, mappings);
  if (selectorError) {
    issues.push({ code: "selector", message: selectorError });
  }
  if (config.cookieAcceptSelector) {
    await page
      .locator(config.cookieAcceptSelector)
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
  const captchaDetected = await detectCaptcha(page);
  if (captchaDetected) {
    issues.push({
      code: "captcha",
      message:
        "Automated submission cannot be tested because this form uses CAPTCHA.",
    });
  }
  const form = await scopedForm(page, config.formSelector);
  const formState = await locatorState(form);
  const formFound = formState.count > 0 && formState.visible;
  if (!formFound) {
    issues.push({
      code: "form",
      message: "The configured form was not found.",
    });
  }
  const passwordDetected = formFound ? await formContainsPassword(form) : false;
  const paymentDetected = formFound
    ? await formContainsPaymentFields(form)
    : false;
  const fileInputDetected = formFound
    ? await formContainsRequiredFileInput(form)
    : false;
  if (passwordDetected) {
    issues.push({
      code: "password",
      message: "Login forms with password fields cannot be tested.",
    });
  }
  if (paymentDetected) {
    issues.push({
      code: "payment",
      message: "Payment and checkout forms cannot be tested.",
    });
  }
  if (fileInputDetected) {
    issues.push({
      code: "file",
      message: "Forms with a required file upload cannot be tested yet.",
    });
  }
  const fields = [];
  for (const mapping of mappings) {
    const state = await locatorState(form.locator(mapping.selector).first());
    fields.push({
      role: mapping.role,
      selector: mapping.selector,
      found: state.count > 0,
      visible: state.visible,
      enabled: state.enabled,
    });
    if (state.count === 0) {
      issues.push({
        code: "field",
        message: "A configured form field was not found.",
        selector: mapping.selector,
      });
    } else if (!state.visible || !state.enabled) {
      issues.push({
        code: "field",
        message: "A configured form field is not usable.",
        selector: mapping.selector,
      });
    }
  }
  const submit = form.locator(config.submitSelector).first();
  const submitState = await locatorState(submit);
  if (submitState.count === 0) {
    issues.push({
      code: "submit",
      message: "The configured submit button was not found.",
    });
  } else if (!submitState.visible) {
    issues.push({
      code: "submit",
      message: "The configured submit button is not visible.",
    });
  } else if (!submitState.enabled) {
    issues.push({
      code: "submit",
      message: "The configured submit button is disabled.",
    });
  }
  const unmappedRequired = formFound
    ? await findUnmappedRequiredFields(form, mappings)
    : [];
  if (unmappedRequired.length > 0) {
    issues.push({
      code: "unmapped",
      message: "Form configuration no longer satisfies required fields.",
    });
  }
  if (!successConfigured(config)) {
    issues.push({
      code: "success",
      message: "Configure at least one success confirmation signal.",
    });
  }
  const discovered = await discoverPageCounts(page);
  return {
    ok: issues.length === 0,
    formFound,
    submitFound: submitState.count > 0,
    submitVisible: submitState.visible,
    submitEnabled: submitState.enabled,
    successConfigured: successConfigured(config),
    captchaDetected,
    passwordDetected,
    paymentDetected,
    fileInputDetected,
    fields,
    unmappedRequired,
    discovered,
    issues,
    validatedAt: new Date().toISOString(),
  };
}

async function fillMappedFields(
  form: Locator,
  values: ResolvedFieldValue[],
): Promise<{ notInteractable: string | null; optionMissing: string | null }> {
  for (const item of values) {
    const field = form.locator(item.selector).first();
    const state = await locatorState(field);
    if (!state.visible || !state.enabled) {
      return { notInteractable: item.selector, optionMissing: null };
    }
    try {
      if (item.control === "SELECT") {
        await field
          .selectOption({ label: item.value }, { timeout: 3_000 })
          .catch(async () => {
            await field.selectOption({ value: item.value }, { timeout: 3_000 });
          });
      } else if (item.control === "CHECKBOX" || item.control === "RADIO") {
        await field.check({ timeout: 3_000 });
      } else {
        await field.fill(item.value, { timeout: 3_000 });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/option/i.test(message) && item.control === "SELECT") {
        return { notInteractable: null, optionMissing: item.selector };
      }
      return { notInteractable: item.selector, optionMissing: null };
    }
  }
  return { notInteractable: null, optionMissing: null };
}

async function waitForSuccess(
  page: Page,
  config: FormMonitorRuntimeConfig,
  timeoutMs: number,
): Promise<{
  success: boolean;
  timedOut: boolean;
  unexpectedNavigation: boolean;
}> {
  const deadline = Date.now() + timeoutMs;
  const startUrl = page.url();
  let startOrigin = "";
  try {
    startOrigin = new URL(startUrl).origin;
  } catch {
    startOrigin = "";
  }
  while (Date.now() < deadline) {
    if (await successMatched(page, config)) {
      return { success: true, timedOut: false, unexpectedNavigation: false };
    }
    let currentOrigin = "";
    try {
      currentOrigin = new URL(page.url()).origin;
    } catch {
      currentOrigin = "";
    }
    if (
      startOrigin &&
      currentOrigin &&
      currentOrigin !== startOrigin &&
      !config.successUrlPattern
    ) {
      return {
        success: false,
        timedOut: false,
        unexpectedNavigation: true,
      };
    }
    await sleep(200);
  }
  const success = await successMatched(page, config);
  return {
    success,
    timedOut: !success,
    unexpectedNavigation: false,
  };
}

async function successMatched(
  page: Page,
  config: FormMonitorRuntimeConfig,
): Promise<boolean> {
  const signals: boolean[] = [];
  if (config.successSelector) {
    const state = await locatorState(
      page.locator(config.successSelector).first(),
    );
    signals.push(state.visible);
  }
  if (config.successUrlPattern) {
    signals.push(matchSuccessUrl(page.url(), config.successUrlPattern));
  }
  if (config.successText) {
    const text = await readVisibleText(page);
    signals.push(visibleTextContains(text, config.successText));
  }
  if (signals.length === 0) return false;
  if (config.successMode === "ANY") return signals.some(Boolean);
  return signals.every(Boolean);
}

function successConfigured(config: FormMonitorRuntimeConfig): boolean {
  return Boolean(
    config.successSelector || config.successUrlPattern || config.successText,
  );
}

function invalidSelectors(
  config: FormMonitorRuntimeConfig,
  mappings: FormFieldMapping[],
): string | null {
  const selectors = [
    config.formSelector,
    config.submitSelector,
    config.cookieAcceptSelector,
    config.successSelector,
    ...mappings.map((item) => item.selector),
  ];
  for (const selector of selectors) {
    if (!selector) continue;
    const parsed = validateCssSelector(selector);
    if (!parsed.ok) return parsed.message;
  }
  if (!successConfigured(config)) {
    return "Configure at least one success confirmation signal.";
  }
  return null;
}

async function attachRouting(
  page: Page,
  options: {
    resolver?: DnsResolver;
    allowPrivateLoopbackForTests?: boolean;
  },
  diagnostics?: { blockedMainDocument: boolean },
): Promise<void> {
  const hostnameCache = new Map<
    string,
    Awaited<ReturnType<typeof evaluateBrowserRequest>>
  >();
  const policy: BrowserRequestPolicyOptions = {
    resolver: options.resolver,
    allowPrivateLoopbackForTests: options.allowPrivateLoopbackForTests,
    hostnameDecisionCache: hostnameCache,
  };
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
    if (
      request.isNavigationRequest() &&
      isSsrfDecision(decision) &&
      diagnostics
    ) {
      diagnostics.blockedMainDocument = true;
    }
    await route.abort("blockedbyclient");
  });
}

async function captureScreenshot(page: Page): Promise<Buffer | null> {
  const config = getBrowserMonitoringConfig();
  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: config.screenshotQuality,
      fullPage: false,
      timeout: 5_000,
    });
    if (buffer.byteLength > config.maxScreenshotBytes) return null;
    return buffer;
  } catch (error) {
    logger.warn("form.screenshot.failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

function contextOptions(viewport: FormMonitorRuntimeConfig["viewport"]) {
  const preset = getBrowserViewportPreset(viewport);
  return {
    viewport: { width: preset.width, height: preset.height },
    userAgent: preset.userAgent,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
    locale: "en-US",
    extraHTTPHeaders: {
      "X-LeadGuard-Monitor": "1",
    },
  };
}

async function preflightTarget(
  requestedUrl: string,
  options: { resolver?: DnsResolver; allowPrivateLoopbackForTests?: boolean },
): Promise<{
  errorType: MonitorCheckErrorType;
  errorMessage: string;
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
        return { errorType: "DNS_ERROR", errorMessage: "DNS lookup failed." };
      }
      return {
        errorType: "UNSAFE_TARGET",
        errorMessage:
          "Private and internal network addresses cannot be monitored.",
      };
    }
    throw error;
  }
}

function emptyFailure(
  requestedUrl: string,
  started: number,
  options: PerformFormCheckOptions,
  failure: {
    errorType: MonitorCheckErrorType;
    errorMessage: string;
    submissionState: FormSubmissionState;
  },
): FormCheckResult {
  return {
    status: "FAILURE",
    httpStatus: null,
    responseTimeMs: Math.round(performance.now() - started),
    requestedUrl,
    finalUrl: null,
    redirectCount: 0,
    resolvedIp: null,
    errorType: failure.errorType,
    errorMessage: failure.errorMessage,
    formDetail: {
      submissionId: options.submissionId,
      submissionState: failure.submissionState,
      successConfirmed: false,
      submissionDurationMs: null,
      submitHttpStatus: null,
      submitEndpointPath: null,
      submitMethod: null,
      fieldsExpectedCount: options.mappings.length,
      fieldsFoundCount: 0,
      formFound: false,
      submitClicked: false,
      captchaDetected: false,
      validationErrors: null,
      unmappedRequiredFields: null,
      screenshotBuffer: null,
    },
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

function isBlockedByClient(error: unknown): boolean {
  return (
    error instanceof Error &&
    /ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(error.message)
  );
}

function isDisconnectedInfrastructure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /has been closed|Target closed|Browser closed|Connection closed/i.test(
    message,
  );
}
