import type {
  MonitorCheckErrorType,
  MonitorCheckStatus,
} from "@/generated/prisma/enums";

export function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  const minutes = seconds / 60;
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

export function formatTimeout(ms: number): string {
  const seconds = ms / 1000;
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

export function formatRelativeTime(date: Date, now = new Date()): string {
  const deltaSeconds = Math.max(
    0,
    Math.round((now.getTime() - date.getTime()) / 1000),
  );
  if (deltaSeconds < 60) return "just now";
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function healthLabel(
  health:
    | "operational"
    | "degraded"
    | "failing"
    | "pending"
    | "pending_confirmation"
    | "down",
): string {
  switch (health) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "failing":
      return "Failing";
    case "down":
      return "Down";
    case "pending_confirmation":
      return "Waiting for receipt";
    default:
      return "Pending first check";
  }
}

export function monitorTypeLabel(
  type: "HTTP" | "BROWSER" | "FORM" | "AD_DESTINATION",
): string {
  if (type === "BROWSER") return "Browser";
  if (type === "FORM") return "Form";
  if (type === "AD_DESTINATION") return "Ad destination";
  return "HTTP";
}

export function viewportLabel(viewport: "DESKTOP" | "MOBILE"): string {
  return viewport === "MOBILE" ? "Mobile" : "Desktop";
}

export function javascriptErrorSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { name?: unknown; message?: unknown };
    const name = typeof record.name === "string" ? record.name : "Error";
    const message = typeof record.message === "string" ? record.message : "";
    const text = `${name}: ${message}`.trim();
    return text ? [text] : [];
  });
}

export function checkStatusLabel(status: MonitorCheckStatus): string {
  if (status === "SUCCESS") return "Success";
  if (status === "DEGRADED") return "Degraded";
  return "Failed";
}

export function checkErrorLabel(
  errorType: MonitorCheckErrorType | null,
  errorMessage: string | null,
): string {
  if (!errorType) return errorMessage ?? "—";
  switch (errorType) {
    case "HTTP_404":
      return "HTTP 404";
    case "HTTP_401":
      return "HTTP 401";
    case "HTTP_403":
      return "HTTP 403";
    case "HTTP_429":
      return "HTTP 429";
    case "HTTP_4XX":
      return "HTTP client error";
    case "HTTP_5XX":
      return "HTTP server error";
    case "SOFT_404":
      return "Soft 404";
    case "TIMEOUT":
      return "Timeout";
    case "DNS_ERROR":
      return "DNS error";
    case "SSL_ERROR":
      return "SSL certificate error";
    case "CONNECTION_ERROR":
      return "Connection failed";
    case "REDIRECT_LOOP":
      return "Redirect loop";
    case "TOO_MANY_REDIRECTS":
      return "Too many redirects";
    case "UNSAFE_REDIRECT":
      return "Unsafe redirect";
    case "UNSAFE_TARGET":
      return "Unsafe target";
    case "INVALID_RESPONSE":
      return "Invalid response";
    case "BROWSER_NAVIGATION_ERROR":
      return "Browser could not open the page";
    case "BROWSER_TIMEOUT":
      return "Browser timed out";
    case "BROWSER_CRASH":
      return "Browser crashed";
    case "PAGE_CRASH":
      return "Page crashed";
    case "JAVASCRIPT_ERROR":
      return "JavaScript error";
    case "REQUIRED_ELEMENT_MISSING":
      return "Required element missing";
    case "CONTENT_NOT_RENDERED":
      return "Page did not render";
    case "UNSAFE_BROWSER_REQUEST":
      return "Unsafe browser request";
    case "TOO_MANY_BROWSER_ERRORS":
      return "Too many browser errors";
    case "INVALID_MONITOR_CONFIGURATION":
      return "Monitor configuration is invalid";
    case "FORM_NOT_FOUND":
      return "Form not found";
    case "FORM_FIELD_MISSING":
      return "Form field missing";
    case "FORM_FIELD_NOT_INTERACTABLE":
      return "Form field not usable";
    case "SUBMIT_BUTTON_MISSING":
      return "Submit button missing";
    case "SUBMIT_BUTTON_DISABLED":
      return "Submit button disabled";
    case "FORM_SUBMISSION_FAILED":
      return "Form submission failed";
    case "FORM_SUBMISSION_TIMEOUT":
      return "Form submission timed out";
    case "FORM_VALIDATION_ERROR":
      return "Form rejected test input";
    case "FORM_SUCCESS_NOT_CONFIRMED":
      return "Success not confirmed";
    case "FORM_UNEXPECTED_NAVIGATION":
      return "Unexpected navigation after submit";
    case "UNSUPPORTED_CAPTCHA":
      return "CAPTCHA blocks automated testing";
    case "UNMAPPED_REQUIRED_FIELD":
      return "Unmapped required field";
    case "FORM_OPTION_MISSING":
      return "Form option missing";
    case "AMBIGUOUS_SUBMISSION":
      return "Submission result could not be confirmed";
    case "UNSUPPORTED_FORM_TYPE":
      return "Unsupported form type";
    case "LEAD_RECEIPT_TIMEOUT":
      return "Lead receipt not confirmed";
    default:
      return errorMessage ?? "Check failed";
  }
}

export function checkIncidentHeadline(
  errorType: MonitorCheckErrorType | null,
  errorMessage: string | null,
): string {
  if (errorType === "SOFT_404") {
    return "Landing page appears to be a 404 page";
  }
  if (errorType === "REQUIRED_ELEMENT_MISSING") {
    return errorMessage ?? "Required element missing";
  }
  if (errorType === "CONTENT_NOT_RENDERED") {
    return "Page loaded but did not render usable content";
  }
  if (errorType === "INVALID_MONITOR_CONFIGURATION") {
    return "Monitor configuration is invalid";
  }
  if (errorType === "FORM_SUBMISSION_FAILED") {
    return "Form submission failed";
  }
  if (errorType === "FORM_SUCCESS_NOT_CONFIRMED") {
    return "Lead form no longer confirms successful submissions";
  }
  if (errorType === "UNSUPPORTED_CAPTCHA") {
    return "Automated submission cannot be tested because this form uses CAPTCHA";
  }
  if (errorType === "AMBIGUOUS_SUBMISSION") {
    return "Submission result could not be confirmed";
  }
  if (errorType === "UNMAPPED_REQUIRED_FIELD") {
    return "Form configuration no longer satisfies required fields";
  }
  if (errorType === "LEAD_RECEIPT_TIMEOUT") {
    return "Lead delivery could not be confirmed";
  }
  return checkErrorLabel(errorType, errorMessage);
}

export function checkErrorDetail(
  errorType: MonitorCheckErrorType | null,
  errorMessage: string | null,
): string | null {
  if (errorType === "SOFT_404") {
    return "LeadGuard detected that the page technically responded successfully but appears to be a not-found page.";
  }
  if (errorType === "REQUIRED_ELEMENT_MISSING") {
    return errorMessage;
  }
  if (errorType === "INVALID_MONITOR_CONFIGURATION") {
    return "This monitor’s selector or settings are invalid. This is not a website outage.";
  }
  if (errorType === "FORM_SUBMISSION_FAILED") {
    return "LeadGuard could open and fill the form, but the submission did not complete successfully.";
  }
  if (errorType === "FORM_SUCCESS_NOT_CONFIRMED") {
    return "The submit request completed, but the configured success confirmation did not appear.";
  }
  if (errorType === "UNSUPPORTED_CAPTCHA") {
    return "Automated submission cannot be tested because this form uses CAPTCHA. This is not a website outage.";
  }
  if (errorType === "AMBIGUOUS_SUBMISSION") {
    return "The previous submission may have reached the website. Retesting can create a second test lead.";
  }
  if (errorType === "UNSUPPORTED_FORM_TYPE") {
    return "Configure only lead or contact forms that are safe for test submissions. Login, payment and file-upload forms are not supported.";
  }
  if (errorType === "LEAD_RECEIPT_TIMEOUT") {
    return "The test form was submitted successfully, but LeadGuard did not receive confirmation that the lead arrived downstream.";
  }
  return errorMessage;
}
