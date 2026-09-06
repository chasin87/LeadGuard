export type DiagnosticClass =
  | "RETRYABLE"
  | "PERMANENT"
  | "CONFIGURATION"
  | "IDENTIFIER"
  | "CONSENT"
  | "NEEDS_REVIEW"
  | "DUPLICATE"
  | "DELAYED";

const classified: Record<string, DiagnosticClass> = {
  PROCESSING_ERROR_REASON_INVALID_GCLID: "IDENTIFIER",
  PROCESSING_ERROR_REASON_INVALID_GBRAID: "IDENTIFIER",
  PROCESSING_ERROR_REASON_INVALID_WBRAID: "IDENTIFIER",
  PROCESSING_ERROR_REASON_INVALID_AD_IDENTIFIERS: "IDENTIFIER",
  PROCESSING_ERROR_REASON_INVALID_CLICK: "IDENTIFIER",
  PROCESSING_ERROR_REASON_EVENT_TOO_OLD: "PERMANENT",
  PROCESSING_ERROR_REASON_CONVERSION_PRECEDES_CLICK: "NEEDS_REVIEW",
  PROCESSING_ERROR_REASON_TOO_RECENT_CLICK: "DELAYED",
  PROCESSING_ERROR_REASON_CLICK_NOT_FOUND: "DELAYED",
  PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER:
    "CONFIGURATION",
  PROCESSING_ERROR_REASON_INVALID_OPERATING_ACCOUNT_FOR_CLICK: "CONFIGURATION",
  PROCESSING_ERROR_REASON_DENIED_CONSENT: "CONSENT",
  PROCESSING_ERROR_REASON_NO_CONSENT: "CONSENT",
  PROCESSING_ERROR_REASON_UNKNOWN_CONSENT: "CONSENT",
  PROCESSING_ERROR_REASON_DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED:
    "CONFIGURATION",
  PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID: "DUPLICATE",
  PROCESSING_ERROR_REASON_DUPLICATE_GCLID: "NEEDS_REVIEW",
  PROCESSING_ERROR_REASON_INTERNAL_ERROR: "RETRYABLE",
  PROCESSING_ERROR_REASON_ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID:
    "CONFIGURATION",
  PROCESSING_ERROR_REASON_INVALID_EVENT: "PERMANENT",
  PROCESSING_ERROR_REASON_INVALID_FORMAT: "PERMANENT",
  PROCESSING_ERROR_REASON_EXTERNAL_ATTRIBUTION_DATA_MISSING: "CONFIGURATION",
};

export function classifyDataManagerDiagnostic(
  reason: string | null | undefined,
): DiagnosticClass {
  if (!reason) return "NEEDS_REVIEW";
  return classified[reason] ?? "NEEDS_REVIEW";
}

export function classifyPrimaryDiagnostic(reasons: string[]): {
  category: DiagnosticClass;
  reason: string | null;
} {
  if (reasons.length === 0) {
    return { category: "NEEDS_REVIEW", reason: null };
  }
  const mapped = reasons.map((reason) => ({
    reason,
    category: classifyDataManagerDiagnostic(reason),
  }));
  const priority: DiagnosticClass[] = [
    "CONSENT",
    "CONFIGURATION",
    "IDENTIFIER",
    "PERMANENT",
    "DUPLICATE",
    "DELAYED",
    "RETRYABLE",
    "NEEDS_REVIEW",
  ];
  for (const category of priority) {
    const match = mapped.find((item) => item.category === category);
    if (match) return match;
  }
  return mapped[0] ?? { category: "NEEDS_REVIEW", reason: reasons[0] ?? null };
}

export function safeDiagnosticCopy(reason: string | null): {
  title: string;
  detail: string;
  action: string;
} {
  switch (reason) {
    case "PROCESSING_ERROR_REASON_INVALID_GCLID":
    case "PROCESSING_ERROR_REASON_INVALID_GBRAID":
    case "PROCESSING_ERROR_REASON_INVALID_WBRAID":
    case "PROCESSING_ERROR_REASON_INVALID_AD_IDENTIFIERS":
    case "PROCESSING_ERROR_REASON_INVALID_CLICK":
      return {
        title: "Google Ads rejected this conversion",
        detail: "The captured click identifier could not be matched.",
        action:
          "Review the lead attribution signal. Do not retry automatically.",
      };
    case "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND":
      return {
        title: "Google Ads rejected this conversion",
        detail: "Click could not be matched.",
        action:
          "Review account mapping after reporting delay, then retry if still eligible.",
      };
    case "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK":
      return {
        title: "Waiting for Google Ads",
        detail: "The click is too recent for conversion processing.",
        action: "LeadGuard will retry automatically within documented limits.",
      };
    case "PROCESSING_ERROR_REASON_EVENT_TOO_OLD":
      return {
        title: "Google Ads rejected this conversion",
        detail: "The conversion time is outside the supported import window.",
        action: "This conversion cannot be sent.",
      };
    case "PROCESSING_ERROR_REASON_CONVERSION_PRECEDES_CLICK":
      return {
        title: "Needs review",
        detail: "The conversion time is earlier than the associated click.",
        action:
          "Review the won time. LeadGuard will not change the timestamp to force a match.",
      };
    case "PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER":
    case "PROCESSING_ERROR_REASON_INVALID_OPERATING_ACCOUNT_FOR_CLICK":
      return {
        title: "Google Ads rejected this conversion",
        detail: "The click does not belong to the selected advertiser account.",
        action: "Review account mapping.",
      };
    case "PROCESSING_ERROR_REASON_DENIED_CONSENT":
    case "PROCESSING_ERROR_REASON_NO_CONSENT":
    case "PROCESSING_ERROR_REASON_UNKNOWN_CONSENT":
      return {
        title: "Google Ads consent diagnostic",
        detail: "Google reported a consent-related processing error.",
        action:
          "Review Google Ads account consent settings. LeadGuard will not bypass this.",
      };
    case "PROCESSING_ERROR_REASON_DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED":
      return {
        title: "Google Ads account setup required",
        detail:
          "Enhanced conversions terms are not signed in the destination account.",
        action:
          "Complete the required terms in Google Ads. LeadGuard cannot accept them for you.",
      };
    case "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID":
      return {
        title: "Needs review",
        detail: "Google already has a conversion with this transaction ID.",
        action:
          "LeadGuard will treat this as idempotent only when it matches this export.",
      };
    case "PROCESSING_ERROR_REASON_ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID":
      return {
        title: "Conversion action not compatible",
        detail:
          "One-per-click conversion actions cannot be used with BRAID identifiers.",
        action:
          "Select a compatible conversion action in Google Ads, then update this mapping.",
      };
    default:
      return {
        title: "Google Ads conversion needs review",
        detail:
          "Google returned a processing diagnostic that LeadGuard cannot classify automatically.",
        action:
          "Review the conversion in Google Ads. LeadGuard will not retry this blindly.",
      };
  }
}
