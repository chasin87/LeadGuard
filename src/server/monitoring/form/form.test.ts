import { describe, expect, it } from "vitest";
import {
  matchSuccessUrl,
  visibleTextContains,
} from "@/server/monitoring/form/success";
import {
  applyPlusAddressing,
  createFormSubmissionId,
} from "@/server/monitoring/form/submission-id";
import { parseFieldMappings } from "@/server/monitoring/form/mappings";
import {
  classifyFormCheck,
  isNonIncidentMonitorError,
} from "@/server/monitoring/form/classify";
import { resolveFormTestValues } from "@/server/monitoring/form/test-data";
import { createFormMonitorSchema } from "@/lib/validation/form-monitor";

describe("form success matching", () => {
  it("matches pathname and glob patterns", () => {
    expect(matchSuccessUrl("https://example.com/bedankt", "/bedankt")).toBe(
      true,
    );
    expect(
      matchSuccessUrl("https://example.com/offerte-bedankt", "/bedankt"),
    ).toBe(false);
    expect(matchSuccessUrl("https://example.com/thanks/1", "/thanks/*")).toBe(
      true,
    );
  });

  it("matches visible text case-insensitively", () => {
    expect(
      visibleTextContains(
        "  Bedankt voor uw aanvraag  ",
        "bedankt voor uw aanvraag",
      ),
    ).toBe(true);
  });
});

describe("form submission ids", () => {
  it("creates unique LeadGuard markers", () => {
    const first = createFormSubmissionId(new Date("2026-08-30T00:00:00Z"));
    const second = createFormSubmissionId(new Date("2026-08-30T00:00:00Z"));
    expect(first).toMatch(/^LG-20260830-[A-Z0-9]{12}$/);
    expect(first).not.toBe(second);
    expect(applyPlusAddressing("leadtests@example.com", first)).toContain("+");
  });
});

describe("form field mappings", () => {
  it("accepts valid mappings and rejects raw attributes", () => {
    const ok = parseFieldMappings([
      { role: "EMAIL", control: "EMAIL", selector: 'input[name="email"]' },
    ]);
    expect(ok.ok).toBe(true);
    const bad = parseFieldMappings([
      { role: "EMAIL", control: "EMAIL", selector: 'data-slot="button"' },
    ]);
    expect(bad.ok).toBe(false);
  });
});

describe("form classification", () => {
  const base = {
    unsafeMainDocument: false,
    navigationTimeout: false,
    navigationError: false,
    browserCrash: false,
    pageCrash: false,
    invalidConfiguration: false,
    captchaDetected: false,
    unsupportedFormType: false,
    mainHttpStatus: 200,
    formFound: true,
    submitFound: true,
    submitVisible: true,
    submitEnabled: true,
    missingFieldSelector: null,
    unmappedRequired: [] as string[],
    notInteractableSelector: null,
    optionMissingSelector: null,
    validationErrors: [] as Array<{ selector: string; message: string }>,
    submitHttpStatus: 200,
    submitClicked: true,
    successConfirmed: true,
    submissionTimedOut: false,
    unexpectedNavigation: false,
    ambiguous: false,
  };

  it("returns success when confirmation is present", () => {
    expect(classifyFormCheck(base).status).toBe("SUCCESS");
  });

  it("classifies backend 500 as submission failed", () => {
    const result = classifyFormCheck({
      ...base,
      successConfirmed: false,
      submitHttpStatus: 500,
    });
    expect(result.errorType).toBe("FORM_SUBMISSION_FAILED");
  });

  it("classifies missing success as not confirmed", () => {
    const result = classifyFormCheck({
      ...base,
      successConfirmed: false,
      submitHttpStatus: 200,
    });
    expect(result.errorType).toBe("FORM_SUCCESS_NOT_CONFIRMED");
  });

  it("does not treat captcha as an incident", () => {
    expect(isNonIncidentMonitorError("UNSUPPORTED_CAPTCHA")).toBe(true);
    expect(isNonIncidentMonitorError("FORM_SUBMISSION_FAILED")).toBe(false);
  });
});

describe("form test data", () => {
  it("requires a phone number when a phone field is mapped", () => {
    const result = resolveFormTestValues({
      mappings: [
        {
          role: "PHONE",
          control: "TEL",
          selector: 'input[name="phone"]',
        },
      ],
      profile: {
        displayName: "LeadGuard Test",
        email: "leadtests@example.com",
        phone: null,
        postcode: null,
        city: null,
        company: null,
        messagePrefix: null,
        plusAddressing: false,
      },
      submissionId: "LG-20260830-ABC123",
    });
    expect(result.ok).toBe(false);
  });

  it("fills a submission id mapping from the runtime value", () => {
    const result = resolveFormTestValues({
      mappings: [
        {
          role: "LEADGUARD_SUBMISSION_ID",
          control: "TEXT",
          selector: 'input[name="leadguard_submission_id"]',
        },
      ],
      profile: {
        displayName: "LeadGuard Test",
        email: "leadtests@example.com",
        phone: null,
        postcode: null,
        city: null,
        company: null,
        messagePrefix: null,
        plusAddressing: false,
      },
      submissionId: "LG-20260830-ABCDEFGHJKMN",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values[0]?.value).toBe("LG-20260830-ABCDEFGHJKMN");
    }
  });
});

describe("form monitor validation", () => {
  const mappings = JSON.stringify([
    { role: "EMAIL", control: "EMAIL", selector: 'input[name="email"]' },
  ]);

  it("rejects a form monitor without consent or success signals", () => {
    const parsed = createFormMonitorSchema.safeParse({
      type: "FORM",
      name: "Quote form",
      url: "https://example.com/offerte",
      intervalSeconds: "21600",
      timeoutMs: "30000",
      consecutiveFailuresBeforeIncident: "2",
      formSelector: "form#quote",
      submitSelector: 'button[type="submit"]',
      fieldMappings: mappings,
      testDisplayName: "LeadGuard Test",
      testEmail: "leadtests@example.com",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a complete form monitor and defaults the submission timeout", () => {
    const parsed = createFormMonitorSchema.safeParse({
      type: "FORM",
      name: "Quote form",
      url: "https://example.com/offerte",
      intervalSeconds: "21600",
      timeoutMs: "30000",
      consecutiveFailuresBeforeIncident: "2",
      formSelector: "form#quote-form",
      submitSelector: 'button[type="submit"]',
      fieldMappings: mappings,
      successSelector: ".thank-you",
      testDisplayName: "LeadGuard Test",
      testEmail: "leadtests@example.com",
      safeFormConfirmed: "true",
      submitConsentConfirmed: "on",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.submissionTimeoutMs).toBe(20_000);
    }
  });

  it("rejects an invalid selector without treating it as a website outage", () => {
    const parsed = createFormMonitorSchema.safeParse({
      type: "FORM",
      name: "Quote form",
      url: "https://example.com/offerte",
      intervalSeconds: "21600",
      timeoutMs: "30000",
      formSelector: 'data-slot="button"',
      submitSelector: 'button[type="submit"]',
      fieldMappings: mappings,
      successSelector: ".thank-you",
      testDisplayName: "LeadGuard Test",
      testEmail: "leadtests@example.com",
      safeFormConfirmed: "true",
      submitConsentConfirmed: "true",
    });
    expect(parsed.success).toBe(false);
  });
});
