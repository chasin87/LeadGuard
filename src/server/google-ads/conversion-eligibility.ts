import { conversionEligibilityPolicy } from "@/server/google-data-manager/config";
import type { GoogleAdsConversionValuePolicy } from "@/generated/prisma/enums";

export type GoogleConversionEligibilityCode =
  | "ELIGIBLE"
  | "INELIGIBLE_NOT_GOOGLE_ATTRIBUTED"
  | "INELIGIBLE_NOT_WON"
  | "INELIGIBLE_NO_ACTIVE_CONFIG"
  | "BLOCKED_NO_REVENUE"
  | "BLOCKED_CONFIG"
  | "BLOCKED_REAUTH"
  | "BLOCKED_INVALID_TIME"
  | "BLOCKED_IDENTIFIER_POLICY"
  | "BLOCKED_NO_IDENTIFIER";

export type GoogleConversionEligibilityInput = {
  outcomeStatus: string;
  wonAt: Date | null;
  leadOccurredAt: Date;
  now: Date;
  hasGclid: boolean;
  hasGbraid: boolean;
  hasWbraid: boolean;
  configStatus: string | null;
  dataManagerReady: boolean;
  valuePolicy: GoogleAdsConversionValuePolicy | null;
  revenueAmountMinor: bigint | null;
  revenueCurrencyCode: string | null;
  clickThroughLookbackDays: number | null;
  countingType: string | null;
};

export type GoogleConversionEligibility = {
  code: GoogleConversionEligibilityCode;
  blockReason: string | null;
  sendValue: boolean;
};

export function evaluateGoogleConversionEligibility(
  input: GoogleConversionEligibilityInput,
): GoogleConversionEligibility {
  if (input.outcomeStatus !== "WON") {
    return {
      code: "INELIGIBLE_NOT_WON",
      blockReason: null,
      sendValue: false,
    };
  }
  const hasGoogleSignal = input.hasGclid || input.hasGbraid || input.hasWbraid;
  if (!hasGoogleSignal) {
    return {
      code: "INELIGIBLE_NOT_GOOGLE_ATTRIBUTED",
      blockReason: "NO_GOOGLE_ATTRIBUTION",
      sendValue: false,
    };
  }
  if (!input.configStatus || input.configStatus === "DISABLED") {
    return {
      code: "INELIGIBLE_NO_ACTIVE_CONFIG",
      blockReason: "CONFIG_DISABLED",
      sendValue: false,
    };
  }
  if (input.configStatus !== "ACTIVE") {
    return {
      code: "BLOCKED_CONFIG",
      blockReason:
        input.configStatus === "NEEDS_REAUTH"
          ? "CONNECTION_REAUTH_REQUIRED"
          : "NO_CONVERSION_ACTION",
      sendValue: false,
    };
  }
  if (!input.dataManagerReady) {
    return {
      code: "BLOCKED_REAUTH",
      blockReason: "NO_DATA_MANAGER_SCOPE",
      sendValue: false,
    };
  }
  if (
    input.countingType === "ONE_PER_CLICK" &&
    !input.hasGclid &&
    (input.hasGbraid || input.hasWbraid)
  ) {
    return {
      code: "BLOCKED_IDENTIFIER_POLICY",
      blockReason: "BRAID_ONE_PER_CLICK",
      sendValue: false,
    };
  }
  if (!input.wonAt) {
    return {
      code: "BLOCKED_INVALID_TIME",
      blockReason: "INVALID_TIMESTAMP",
      sendValue: false,
    };
  }
  if (input.wonAt.getTime() < input.leadOccurredAt.getTime()) {
    return {
      code: "BLOCKED_INVALID_TIME",
      blockReason: "INVALID_TIMESTAMP",
      sendValue: false,
    };
  }
  if (
    input.wonAt.getTime() >
    input.now.getTime() + conversionEligibilityPolicy.futureSkewMs
  ) {
    return {
      code: "BLOCKED_INVALID_TIME",
      blockReason: "EVENT_IN_FUTURE",
      sendValue: false,
    };
  }
  const lookbackDays =
    input.clickThroughLookbackDays ??
    conversionEligibilityPolicy.fallbackClickThroughLookbackDays;
  const oldest = input.now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  if (input.wonAt.getTime() < oldest) {
    return {
      code: "BLOCKED_INVALID_TIME",
      blockReason: "EVENT_TOO_OLD",
      sendValue: false,
    };
  }
  const hasRevenue =
    input.revenueAmountMinor !== null && input.revenueCurrencyCode !== null;
  if (input.valuePolicy === "REQUIRE_REVENUE" && !hasRevenue) {
    return {
      code: "BLOCKED_NO_REVENUE",
      blockReason: "NO_REVENUE",
      sendValue: false,
    };
  }
  const sendValue = input.valuePolicy !== "NO_VALUE" && hasRevenue;
  return { code: "ELIGIBLE", blockReason: null, sendValue };
}
