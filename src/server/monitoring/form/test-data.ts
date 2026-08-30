import type { FormFieldMapping } from "@/server/monitoring/form/types";
import { applyPlusAddressing } from "@/server/monitoring/form/submission-id";

export type FormTestProfileValues = {
  displayName: string;
  email: string;
  phone: string | null;
  postcode: string | null;
  city: string | null;
  company: string | null;
  messagePrefix: string | null;
  plusAddressing: boolean;
};

export type ResolvedFieldValue = {
  selector: string;
  control: FormFieldMapping["control"];
  role: FormFieldMapping["role"];
  value: string;
};

const defaultMessage = (id: string) =>
  `[LEADGUARD TEST ${id}]\nThis is an automated LeadGuard control test. Not a real customer request.`;

export function resolveFormTestValues(input: {
  mappings: FormFieldMapping[];
  profile: FormTestProfileValues | null;
  submissionId: string;
  inboundEmail?: string | null;
}):
  { ok: true; values: ResolvedFieldValue[] } | { ok: false; message: string } {
  if (!input.profile) {
    return {
      ok: false,
      message: "A test profile with a name and email is required.",
    };
  }
  const email = input.profile.plusAddressing
    ? applyPlusAddressing(input.profile.email, input.submissionId)
    : input.profile.email;
  const values: ResolvedFieldValue[] = [];

  for (const mapping of input.mappings) {
    const value = valueForMapping(mapping, {
      profile: input.profile,
      email: input.inboundEmail || email,
      submissionId: input.submissionId,
    });
    if (value === null) {
      return {
        ok: false,
        message: missingValueMessage(mapping),
      };
    }
    values.push({
      selector: mapping.selector,
      control: mapping.control,
      role: mapping.role,
      value,
    });
  }
  return { ok: true, values };
}

function valueForMapping(
  mapping: FormFieldMapping,
  ctx: {
    profile: FormTestProfileValues;
    email: string;
    submissionId: string;
  },
): string | null {
  if (mapping.control === "CHECKBOX") return "checked";
  if (mapping.value?.trim()) return mapping.value.trim();

  switch (mapping.role) {
    case "NAME":
      return ctx.profile.displayName || "LeadGuard Test";
    case "EMAIL":
      return ctx.email;
    case "PHONE":
      return ctx.profile.phone?.trim() || null;
    case "POSTCODE":
      return ctx.profile.postcode?.trim() || null;
    case "HOUSE_NUMBER":
      return mapping.value?.trim() || "1";
    case "CITY":
      return ctx.profile.city?.trim() || null;
    case "COMPANY":
      return ctx.profile.company?.trim() || "LeadGuard";
    case "MESSAGE":
      return ctx.profile.messagePrefix?.trim()
        ? `${ctx.profile.messagePrefix.trim()}\n${defaultMessage(ctx.submissionId)}`
        : defaultMessage(ctx.submissionId);
    case "LEADGUARD_SUBMISSION_ID":
      return ctx.submissionId;
    case "CUSTOM":
      return mapping.value?.trim() || null;
    default:
      return mapping.value?.trim() || null;
  }
}

function missingValueMessage(mapping: FormFieldMapping): string {
  if (mapping.role === "PHONE") {
    return "Configure a test phone number before mapping a phone field.";
  }
  if (mapping.role === "POSTCODE") {
    return "Configure a test postcode before mapping a postcode field.";
  }
  if (mapping.role === "CITY") {
    return "Configure a test city before mapping a city field.";
  }
  if (
    mapping.role === "CUSTOM" ||
    mapping.control === "SELECT" ||
    mapping.control === "RADIO"
  ) {
    return "Custom, select and radio fields need an explicit test value.";
  }
  return "The test profile is missing a required value for a mapped field.";
}
