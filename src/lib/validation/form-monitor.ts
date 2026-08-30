import { z } from "zod";
import { validateCssSelector } from "@/server/monitoring/browser/selector";
import {
  allowedFormMonitorIntervals,
  getFormMonitoringConfig,
} from "@/server/monitoring/form/config";
import { parseFieldMappings } from "@/server/monitoring/form/mappings";
import {
  browserViewportSchema,
  incidentThresholdSchema,
  monitorNameSchema,
  monitorUrlInputSchema,
} from "@/lib/validation/monitor";

const formConfig = getFormMonitoringConfig();

const requiredSelectorSchema = z
  .string()
  .trim()
  .min(1, "Enter a CSS selector.")
  .max(300)
  .superRefine((value, ctx) => {
    const parsed = validateCssSelector(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
    }
  });

const optionalSelectorSchema = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => value?.trim() || "")
  .superRefine((value, ctx) => {
    if (!value) return;
    const parsed = validateCssSelector(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
    }
  });

const formIntervalSchema = z.coerce
  .number()
  .int()
  .refine(
    (value) =>
      allowedFormMonitorIntervals.includes(
        value as (typeof allowedFormMonitorIntervals)[number],
      ) && value >= formConfig.minIntervalSeconds,
    "Form monitors can run at most once per hour.",
  );

const formTimeoutSchema = z.coerce
  .number()
  .int()
  .min(formConfig.minTimeoutMs, "Timeout must be at least 5 seconds.")
  .max(formConfig.maxTimeoutMs, "Timeout may be at most 45 seconds.");

const submissionTimeoutSchema = z.preprocess(
  (value) =>
    value === "" || value === null || value === undefined
      ? formConfig.defaultSubmissionTimeoutMs
      : value,
  z.coerce
    .number()
    .int()
    .min(
      formConfig.minSubmissionTimeoutMs,
      "Submission timeout must be at least 5 seconds.",
    )
    .max(
      formConfig.maxSubmissionTimeoutMs,
      "Submission timeout may be at most 30 seconds.",
    ),
);

const successModeSchema = z.enum(["ANY", "SELECTOR", "URL", "TEXT"]);

const fieldMappingsSchema = z
  .string()
  .trim()
  .min(1, "Map at least one form field.")
  .transform((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Field mappings are invalid." });
      return [];
    }
    const mappings = parseFieldMappings(parsed);
    if (!mappings.ok) {
      ctx.addIssue({ code: "custom", message: mappings.message });
      return [];
    }
    return mappings.value;
  });

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid test email address.")
  .max(254);

const testProfileInlineSchema = z.object({
  testProfileId: z.string().trim().optional(),
  testProfileName: z.string().trim().max(80).optional(),
  testDisplayName: z.string().trim().max(80).optional(),
  testEmail: z.string().trim().max(254).optional(),
  testPhone: z.string().trim().max(32).optional(),
  testPostcode: z.string().trim().max(16).optional(),
  testCity: z.string().trim().max(80).optional(),
  testCompany: z.string().trim().max(80).optional(),
  plusAddressing: z.enum(["true", "false", "on", ""]).optional(),
});

function hasSuccessSignal(data: {
  successSelector: string;
  successUrlPattern: string;
  successText: string;
}) {
  return Boolean(
    data.successSelector || data.successUrlPattern || data.successText.trim(),
  );
}

const consentSchema = z.preprocess(
  (value) => value === "true" || value === "on" || value === true,
  z.literal(true, {
    error: "Confirm that this form is safe for automated test submissions.",
  }),
);

const formMonitorFields = {
  name: monitorNameSchema,
  url: monitorUrlInputSchema,
  intervalSeconds: formIntervalSchema.default(
    formConfig.defaultIntervalSeconds,
  ),
  timeoutMs: formTimeoutSchema.default(formConfig.defaultTimeoutMs),
  consecutiveFailuresBeforeIncident: incidentThresholdSchema.default(2),
  viewport: browserViewportSchema.default("DESKTOP"),
  formSelector: requiredSelectorSchema,
  submitSelector: requiredSelectorSchema,
  cookieAcceptSelector: optionalSelectorSchema,
  fieldMappings: fieldMappingsSchema,
  successMode: successModeSchema.default("ANY"),
  successSelector: optionalSelectorSchema,
  successUrlPattern: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v ?? ""),
  successText: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v ?? ""),
  submissionTimeoutMs: submissionTimeoutSchema,
  ...testProfileInlineSchema.shape,
};

export const createFormMonitorSchema = z
  .object({
    type: z.literal("FORM"),
    ...formMonitorFields,
    safeFormConfirmed: consentSchema,
    submitConsentConfirmed: consentSchema,
  })
  .superRefine((data, ctx) => {
    if (!hasSuccessSignal(data)) {
      ctx.addIssue({
        code: "custom",
        path: ["successSelector"],
        message: "Configure at least one success confirmation signal.",
      });
    }
    if (!data.testProfileId && (!data.testEmail || !data.testDisplayName)) {
      ctx.addIssue({
        code: "custom",
        path: ["testEmail"],
        message: "Choose a test profile or enter a test name and email.",
      });
    }
    if (data.testEmail) {
      const email = emailSchema.safeParse(data.testEmail);
      if (!email.success) {
        ctx.addIssue({
          code: "custom",
          path: ["testEmail"],
          message: "Enter a valid test email address.",
        });
      }
    }
  });

export const updateFormMonitorSchema = z
  .object({
    type: z.literal("FORM").optional(),
    status: z.enum(["ACTIVE", "PAUSED"]),
    ...formMonitorFields,
  })
  .superRefine((data, ctx) => {
    if (!hasSuccessSignal(data)) {
      ctx.addIssue({
        code: "custom",
        path: ["successSelector"],
        message: "Configure at least one success confirmation signal.",
      });
    }
  });

export const createFormTestProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(80),
  email: emailSchema,
  phone: z.string().trim().max(32).optional(),
  postcode: z.string().trim().max(16).optional(),
  city: z.string().trim().max(80).optional(),
  company: z.string().trim().max(80).optional(),
  messagePrefix: z.string().trim().max(200).optional(),
  plusAddressing: z.boolean().optional(),
});

export const updateFormTestProfileSchema = createFormTestProfileSchema;

export type CreateFormMonitorInput = z.infer<typeof createFormMonitorSchema>;
export type UpdateFormMonitorInput = z.infer<typeof updateFormMonitorSchema>;
