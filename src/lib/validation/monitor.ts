import { z } from "zod";
import {
  allowedMonitorIntervals,
  getMonitoringConfig,
} from "@/server/monitoring/config";
import {
  allowedBrowserMonitorIntervals,
  getBrowserMonitoringConfig,
} from "@/server/monitoring/browser/config";
import {
  validateCssSelector,
  validateRequiredElementName,
} from "@/server/monitoring/browser/selector";

const httpConfig = getMonitoringConfig();
const browserConfig = getBrowserMonitoringConfig();

export const monitorNameSchema = z
  .string()
  .trim()
  .min(2, "Monitor name must be at least 2 characters.")
  .max(80, "Monitor name may be at most 80 characters.");

export const monitorUrlInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a valid public page URL.")
  .max(2048, "Enter a valid public page URL.");

export const monitorTypeSchema = z.enum(["HTTP", "BROWSER", "FORM"]);
export const browserViewportSchema = z.enum(["DESKTOP", "MOBILE"]);

export const monitorStatusSchema = z.enum(["ACTIVE", "PAUSED"]);

export const incidentThresholdSchema = z.coerce
  .number()
  .int()
  .min(
    httpConfig.minIncidentThreshold,
    "Incident threshold must be at least 1.",
  )
  .max(
    httpConfig.maxIncidentThreshold,
    "Incident threshold may be at most 10.",
  );

const httpIntervalSchema = z.coerce
  .number()
  .int()
  .refine(
    (value) =>
      allowedMonitorIntervals.includes(
        value as (typeof allowedMonitorIntervals)[number],
      ) && value >= httpConfig.minIntervalSeconds,
    "Choose a supported check frequency of at least 5 minutes.",
  );

const browserIntervalSchema = z.coerce
  .number()
  .int()
  .refine(
    (value) =>
      allowedBrowserMonitorIntervals.includes(
        value as (typeof allowedBrowserMonitorIntervals)[number],
      ) && value >= browserConfig.minIntervalSeconds,
    "Browser monitors can run at most every 10 minutes.",
  );

const httpTimeoutSchema = z.coerce
  .number()
  .int()
  .min(httpConfig.minTimeoutMs, "Timeout must be at least 1 second.")
  .max(httpConfig.maxTimeoutMs, "Timeout may be at most 30 seconds.");

const browserTimeoutSchema = z.coerce
  .number()
  .int()
  .min(browserConfig.minTimeoutMs, "Timeout must be at least 5 seconds.")
  .max(browserConfig.maxTimeoutMs, "Timeout may be at most 45 seconds.");

const optionalSelectorSchema = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => value ?? "")
  .superRefine((value, ctx) => {
    const parsed = validateCssSelector(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
    }
  });

const optionalElementNameSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => value ?? "")
  .superRefine((value, ctx) => {
    const parsed = validateRequiredElementName(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
    }
  });

const createHttpMonitorSchema = z.object({
  type: z.literal("HTTP").default("HTTP"),
  name: monitorNameSchema,
  url: monitorUrlInputSchema,
  intervalSeconds: httpIntervalSchema.default(
    httpConfig.defaultIntervalSeconds,
  ),
  timeoutMs: httpTimeoutSchema.default(httpConfig.defaultTimeoutMs),
  consecutiveFailuresBeforeIncident: incidentThresholdSchema.default(
    httpConfig.defaultIncidentThreshold,
  ),
});

const createBrowserMonitorSchema = z.object({
  type: z.literal("BROWSER"),
  name: monitorNameSchema,
  url: monitorUrlInputSchema,
  intervalSeconds: browserIntervalSchema.default(
    browserConfig.defaultIntervalSeconds,
  ),
  timeoutMs: browserTimeoutSchema.default(browserConfig.defaultTimeoutMs),
  consecutiveFailuresBeforeIncident: incidentThresholdSchema.default(
    httpConfig.defaultIncidentThreshold,
  ),
  viewport: browserViewportSchema.default("DESKTOP"),
  requiredSelector: optionalSelectorSchema,
  requiredElementName: optionalElementNameSchema,
});

export const createMonitorSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.type == null || record.type === "") {
      return { ...record, type: "HTTP" };
    }
    return value;
  },
  z.discriminatedUnion("type", [
    createHttpMonitorSchema,
    createBrowserMonitorSchema,
  ]),
);

export const updateHttpMonitorSchema = z.object({
  type: z.literal("HTTP").optional(),
  name: monitorNameSchema,
  url: monitorUrlInputSchema,
  intervalSeconds: httpIntervalSchema,
  timeoutMs: httpTimeoutSchema,
  status: monitorStatusSchema,
  consecutiveFailuresBeforeIncident: incidentThresholdSchema,
});

export const updateBrowserMonitorSchema = z.object({
  type: z.literal("BROWSER").optional(),
  name: monitorNameSchema,
  url: monitorUrlInputSchema,
  intervalSeconds: browserIntervalSchema,
  timeoutMs: browserTimeoutSchema,
  status: monitorStatusSchema,
  consecutiveFailuresBeforeIncident: incidentThresholdSchema,
  viewport: browserViewportSchema,
  requiredSelector: optionalSelectorSchema,
  requiredElementName: optionalElementNameSchema,
});

export const updateMonitorSchema = z.union([
  updateBrowserMonitorSchema,
  updateHttpMonitorSchema,
]);

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
