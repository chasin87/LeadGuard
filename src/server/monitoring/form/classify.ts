import type {
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";

export type FormClassification = {
  status: MonitorCheckStatus;
  errorType: MonitorCheckErrorType | null;
  errorMessage: string | null;
};

/**
 * Precedence (highest first):
 * unsafe request
 * > navigation timeout / crash / navigation error
 * > invalid monitor configuration
 * > unsupported captcha / unsupported form type
 * > HTTP 4xx/5xx on the main document
 * > form not found / submit missing / field missing
 * > unmapped required field
 * > field not interactable / option missing / submit disabled
 * > form validation error
 * > form submission failed (5xx API)
 * > success not confirmed / timeout / unexpected navigation / ambiguous
 * > success
 */
export function classifyFormCheck(input: {
  unsafeMainDocument: boolean;
  navigationTimeout: boolean;
  navigationError: boolean;
  browserCrash: boolean;
  pageCrash: boolean;
  invalidConfiguration: boolean;
  invalidConfigurationMessage?: string;
  captchaDetected: boolean;
  unsupportedFormType: boolean;
  unsupportedFormTypeMessage?: string;
  mainHttpStatus: number | null;
  formFound: boolean;
  submitFound: boolean;
  submitVisible: boolean;
  submitEnabled: boolean;
  missingFieldSelector: string | null;
  unmappedRequired: string[];
  notInteractableSelector: string | null;
  optionMissingSelector: string | null;
  validationErrors: Array<{ selector: string; message: string }>;
  submitHttpStatus: number | null;
  submitClicked: boolean;
  successConfirmed: boolean;
  submissionTimedOut: boolean;
  unexpectedNavigation: boolean;
  ambiguous: boolean;
}): FormClassification {
  if (input.unsafeMainDocument) {
    return fail(
      "UNSAFE_BROWSER_REQUEST",
      "The page tried to navigate to an address that cannot be monitored.",
    );
  }
  if (input.navigationTimeout) {
    return fail("BROWSER_TIMEOUT", "The page did not finish loading in time.");
  }
  if (input.browserCrash) {
    return fail(
      "BROWSER_CRASH",
      "The browser process crashed while loading this page.",
    );
  }
  if (input.pageCrash) {
    return fail("PAGE_CRASH", "The page crashed while rendering.");
  }
  if (input.navigationError) {
    return fail(
      "BROWSER_NAVIGATION_ERROR",
      "The browser could not open this page.",
    );
  }
  if (input.invalidConfiguration) {
    return fail(
      "INVALID_MONITOR_CONFIGURATION",
      input.invalidConfigurationMessage ??
        "Form monitor configuration is invalid.",
    );
  }
  if (input.captchaDetected) {
    return fail(
      "UNSUPPORTED_CAPTCHA",
      "Automated submission cannot be tested because this form uses CAPTCHA.",
    );
  }
  if (input.unsupportedFormType) {
    return fail(
      "UNSUPPORTED_FORM_TYPE",
      input.unsupportedFormTypeMessage ??
        "This form cannot be tested automatically.",
    );
  }
  if (input.mainHttpStatus != null && input.mainHttpStatus >= 400) {
    return httpFailure(input.mainHttpStatus);
  }
  if (!input.formFound) {
    return fail("FORM_NOT_FOUND", "The configured form was not found.");
  }
  if (!input.submitFound) {
    return fail(
      "SUBMIT_BUTTON_MISSING",
      "The configured submit button was not found.",
    );
  }
  if (!input.submitVisible) {
    return fail(
      "SUBMIT_BUTTON_MISSING",
      "The configured submit button is not visible.",
    );
  }
  if (input.missingFieldSelector) {
    return fail(
      "FORM_FIELD_MISSING",
      "A configured form field is no longer on the page.",
    );
  }
  if (input.unmappedRequired.length > 0) {
    return fail(
      "UNMAPPED_REQUIRED_FIELD",
      "Form configuration no longer satisfies required fields.",
    );
  }
  if (input.notInteractableSelector) {
    return fail(
      "FORM_FIELD_NOT_INTERACTABLE",
      "A configured form field is visible but cannot be used like a visitor would.",
    );
  }
  if (input.optionMissingSelector) {
    return fail(
      "FORM_OPTION_MISSING",
      "A configured select or radio option is no longer available.",
    );
  }
  if (!input.submitEnabled) {
    return fail(
      "SUBMIT_BUTTON_DISABLED",
      "The submit button is visible but disabled.",
    );
  }
  if (input.validationErrors.length > 0) {
    return fail(
      "FORM_VALIDATION_ERROR",
      "The form rejected LeadGuard test input. Check the field mappings and test profile.",
    );
  }
  if (
    input.submitHttpStatus != null &&
    input.submitHttpStatus >= 500 &&
    input.submitHttpStatus <= 599
  ) {
    return fail(
      "FORM_SUBMISSION_FAILED",
      "LeadGuard could open and fill the form, but the submission did not complete successfully.",
    );
  }
  if (input.ambiguous) {
    return fail(
      "AMBIGUOUS_SUBMISSION",
      "Submission result could not be confirmed. The previous submission may have reached the website.",
    );
  }
  if (input.unexpectedNavigation) {
    return fail(
      "FORM_UNEXPECTED_NAVIGATION",
      "Submitting the form navigated to an unexpected page.",
    );
  }
  if (
    input.submitClicked &&
    input.submissionTimedOut &&
    !input.successConfirmed
  ) {
    return fail(
      "FORM_SUBMISSION_TIMEOUT",
      "The form did not confirm success before the submission timeout.",
    );
  }
  if (input.submitClicked && !input.successConfirmed) {
    return fail(
      "FORM_SUCCESS_NOT_CONFIRMED",
      "Lead form no longer confirms successful submissions.",
    );
  }
  return { status: "SUCCESS", errorType: null, errorMessage: null };
}

function fail(
  errorType: MonitorCheckErrorType,
  errorMessage: string,
): FormClassification {
  return { status: "FAILURE", errorType, errorMessage };
}

function httpFailure(httpStatus: number): FormClassification {
  if (httpStatus === 404) {
    return fail("HTTP_404", "The page returned HTTP 404.");
  }
  if (httpStatus >= 500) {
    return fail("HTTP_5XX", `The page returned HTTP ${httpStatus}.`);
  }
  if (httpStatus >= 400) {
    return fail("HTTP_4XX", `The page returned HTTP ${httpStatus}.`);
  }
  return fail("INVALID_RESPONSE", `Unexpected HTTP status ${httpStatus}.`);
}

export function isNonIncidentMonitorError(
  errorType: MonitorCheckErrorType | null,
): boolean {
  return (
    errorType === "INVALID_MONITOR_CONFIGURATION" ||
    errorType === "UNSUPPORTED_CAPTCHA" ||
    errorType === "UNSUPPORTED_FORM_TYPE"
  );
}
