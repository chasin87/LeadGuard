import { describe, expect, it } from "vitest";
import { evaluateGoogleConversionEligibility } from "@/server/google-ads/conversion-eligibility";
import { capabilitiesFromGrantedScopes } from "@/server/google-ads/scopes";
import { classifyDataManagerDiagnostic } from "@/server/google-data-manager/diagnostics";
import { toDataManagerConversionValue } from "@/server/google-data-manager/value";
import { parseMoney } from "@/lib/money";
import { toRfc3339Utc } from "@/server/google-ads/conversion-export";

describe("Google conversion eligibility", () => {
  const now = new Date("2026-08-31T12:00:00.000Z");
  const wonAt = new Date("2026-08-31T11:18:00.000Z");
  const base = {
    outcomeStatus: "WON",
    wonAt,
    leadOccurredAt: new Date("2026-08-01T10:00:00.000Z"),
    now,
    hasGclid: true,
    hasGbraid: false,
    hasWbraid: false,
    configStatus: "ACTIVE",
    dataManagerReady: true,
    valuePolicy: "REVENUE_IF_AVAILABLE" as const,
    revenueAmountMinor: 450000n,
    revenueCurrencyCode: "EUR",
    clickThroughLookbackDays: 90,
    countingType: "ONE_PER_CLICK",
  };

  it("exports only Google-attributed WON leads", () => {
    expect(evaluateGoogleConversionEligibility(base).code).toBe("ELIGIBLE");
    expect(
      evaluateGoogleConversionEligibility({
        ...base,
        outcomeStatus: "QUALIFIED",
      }).code,
    ).toBe("INELIGIBLE_NOT_WON");
    expect(
      evaluateGoogleConversionEligibility({ ...base, outcomeStatus: "LOST" })
        .code,
    ).toBe("INELIGIBLE_NOT_WON");
    expect(
      evaluateGoogleConversionEligibility({
        ...base,
        hasGclid: false,
        hasGbraid: false,
        hasWbraid: false,
      }).code,
    ).toBe("INELIGIBLE_NOT_GOOGLE_ATTRIBUTED");
  });

  it("blocks REQUIRE_REVENUE until revenue exists and allows WON without value", () => {
    expect(
      evaluateGoogleConversionEligibility({
        ...base,
        valuePolicy: "REQUIRE_REVENUE",
        revenueAmountMinor: null,
        revenueCurrencyCode: null,
      }).code,
    ).toBe("BLOCKED_NO_REVENUE");
    const withoutRevenue = evaluateGoogleConversionEligibility({
      ...base,
      revenueAmountMinor: null,
      revenueCurrencyCode: null,
    });
    expect(withoutRevenue.code).toBe("ELIGIBLE");
    expect(withoutRevenue.sendValue).toBe(false);
    const noValue = evaluateGoogleConversionEligibility({
      ...base,
      valuePolicy: "NO_VALUE",
    });
    expect(noValue.sendValue).toBe(false);
  });

  it("rejects future won times and uses wonAt", () => {
    expect(
      evaluateGoogleConversionEligibility({
        ...base,
        wonAt: new Date("2026-09-02T00:00:00.000Z"),
      }).code,
    ).toBe("BLOCKED_INVALID_TIME");
    expect(toRfc3339Utc(wonAt)).toBe("2026-08-31T11:18:00.000Z");
  });
});

describe("Data Manager conversion value", () => {
  it("serializes EUR, JPY and KWD from minor units", () => {
    const eur = parseMoney("4500.00", "EUR");
    expect(toDataManagerConversionValue(eur.amountMinor, "EUR")).toMatchObject({
      conversionValue: 4500,
      currency: "EUR",
      decimal: "4500.00",
    });
    const jpy = parseMoney("4500", "JPY");
    expect(
      toDataManagerConversionValue(jpy.amountMinor, "JPY").conversionValue,
    ).toBe(4500);
    const kwd = parseMoney("1.234", "KWD");
    expect(toDataManagerConversionValue(kwd.amountMinor, "KWD")).toMatchObject({
      conversionValue: 1.234,
      decimal: "1.234",
    });
  });
});

describe("Data Manager diagnostics", () => {
  it("classifies identifier, delayed, consent and unknown reasons", () => {
    expect(
      classifyDataManagerDiagnostic("PROCESSING_ERROR_REASON_INVALID_GCLID"),
    ).toBe("IDENTIFIER");
    expect(
      classifyDataManagerDiagnostic("PROCESSING_ERROR_REASON_TOO_RECENT_CLICK"),
    ).toBe("DELAYED");
    expect(
      classifyDataManagerDiagnostic("PROCESSING_ERROR_REASON_EVENT_TOO_OLD"),
    ).toBe("PERMANENT");
    expect(
      classifyDataManagerDiagnostic("PROCESSING_ERROR_REASON_DENIED_CONSENT"),
    ).toBe("CONSENT");
    expect(
      classifyDataManagerDiagnostic("PROCESSING_ERROR_REASON_NEW_FUTURE"),
    ).toBe("NEEDS_REVIEW");
  });
});

describe("Google connection capabilities", () => {
  it("keeps Ads read without assuming Data Manager access", () => {
    const adsOnly = capabilitiesFromGrantedScopes(
      "https://www.googleapis.com/auth/adwords",
      "CONNECTED",
    );
    expect(adsOnly.adsRead).toBe(true);
    expect(adsOnly.dataManager).toBe(false);
    expect(adsOnly.dataManagerStatus).toBe("REAUTH_REQUIRED");
    const both = capabilitiesFromGrantedScopes(
      "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager",
      "CONNECTED",
    );
    expect(both.dataManagerStatus).toBe("READY");
  });
});
