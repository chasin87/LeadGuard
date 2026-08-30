import { afterEach, describe, expect, it } from "vitest";
import { getGoogleAdsReadProvider } from "@/server/google-ads/clients";
import {
  assertFakeProviderNotUsedInProduction,
  googleAdsApiVersion,
} from "@/server/google-ads/config";
import { googleAdsQueries } from "@/server/google-ads/queries";

const originalProvider = process.env.GOOGLE_ADS_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.GOOGLE_ADS_PROVIDER;
  } else {
    process.env.GOOGLE_ADS_PROVIDER = originalProvider;
  }
});

describe("Google Ads provider boundary", () => {
  it("centralizes API v25", () => {
    expect(googleAdsApiVersion).toBe("v25");
  });

  it("keeps metric queries read-only and conversion-free", () => {
    const hourly = googleAdsQueries.adHourlyMetrics(
      "2026-08-30",
      "2026-08-30",
      ["1001"],
    );
    expect(hourly).toMatch(/segments\.hour/);
    expect(hourly).not.toMatch(/mutate|conversions/i);
    expect(
      googleAdsQueries.landingPageDailyMetrics("2026-08-30", "2026-08-30"),
    ).not.toMatch(/segments\.hour/);
  });

  it("exposes only read methods", () => {
    const provider = getGoogleAdsReadProvider();
    expect(Object.keys(provider).sort()).toEqual([
      "getAdHourlyMetrics",
      "getAssetGroupHourlyMetrics",
      "getCustomer",
      "getCustomerHierarchy",
      "getExpandedLandingPageDailyMetrics",
      "getLandingPageDailyMetrics",
      "listAccessibleCustomers",
      "syncObservedLandingPages",
      "syncPerformanceMaxDestinations",
      "syncStandardAdDestinations",
    ]);
    expect(JSON.stringify(Object.keys(provider))).not.toMatch(
      /mutate|pause|upload|create|update|remove/i,
    );
  });

  it("rejects the fake provider in production", () => {
    expect(() => assertFakeProviderNotUsedInProduction("production")).toThrow(
      /fake/i,
    );
  });
});
