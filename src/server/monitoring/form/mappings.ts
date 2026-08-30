import type { FormFieldControl, FormFieldRole } from "@/generated/prisma/enums";
import { validateCssSelector } from "@/server/monitoring/browser/selector";
import type { FormFieldMapping } from "@/server/monitoring/form/types";

const roles = new Set<FormFieldRole>([
  "NAME",
  "EMAIL",
  "PHONE",
  "POSTCODE",
  "HOUSE_NUMBER",
  "CITY",
  "MESSAGE",
  "COMPANY",
  "LEADGUARD_SUBMISSION_ID",
  "CUSTOM",
]);
const controls = new Set<FormFieldControl>([
  "TEXT",
  "EMAIL",
  "TEL",
  "TEXTAREA",
  "SELECT",
  "CHECKBOX",
  "RADIO",
]);

export function parseFieldMappings(
  value: unknown,
): { ok: true; value: FormFieldMapping[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: "Map at least one form field." };
  }
  if (value.length > 20) {
    return { ok: false, message: "A form monitor may map at most 20 fields." };
  }
  const mappings: FormFieldMapping[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "Each field mapping must be an object." };
    }
    const record = item as Record<string, unknown>;
    const role = String(record.role ?? "") as FormFieldRole;
    const control = String(record.control ?? "") as FormFieldControl;
    if (!roles.has(role) || !controls.has(control)) {
      return { ok: false, message: "Choose a supported field type." };
    }
    const selectorParsed = validateCssSelector(String(record.selector ?? ""));
    if (!selectorParsed.ok || !selectorParsed.value) {
      return {
        ok: false,
        message: selectorParsed.ok
          ? "Every mapped field needs a CSS selector."
          : selectorParsed.message,
      };
    }
    if (seen.has(selectorParsed.value)) {
      return { ok: false, message: "Each field selector must be unique." };
    }
    seen.add(selectorParsed.value);
    const label =
      typeof record.label === "string" ? record.label.trim().slice(0, 80) : "";
    const customValue =
      typeof record.value === "string" ? record.value.trim().slice(0, 200) : "";
    if (
      (control === "SELECT" || control === "RADIO" || role === "CUSTOM") &&
      role !== "LEADGUARD_SUBMISSION_ID" &&
      control !== "CHECKBOX" &&
      !customValue
    ) {
      return {
        ok: false,
        message: "Select, radio and custom fields need an explicit test value.",
      };
    }
    mappings.push({
      role,
      control,
      selector: selectorParsed.value,
      label: label || undefined,
      value: customValue || undefined,
    });
  }
  return { ok: true, value: mappings };
}
