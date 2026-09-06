import { afterEach, describe, expect, it } from "vitest";
import { getGoogleAdsReadProvider } from "@/server/google-ads/clients";
import {
  assertFakeProviderNotUsedInProduction,
  googleAdsApiVersion,
} from "@/server/google-ads/config";
import { googleAdsQueries } from "@/server/google-ads/queries";

const originalProvider = process.env.GOOGLE_ADS_PROVIDER;
const originalE2eRuntime = process.env.E2E_RUNTIME;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.GOOGLE_ADS_PROVIDER;
  } else {
    process.env.GOOGLE_ADS_PROVIDER = originalProvider;
  }
  if (originalE2eRuntime === undefined) {
    delete process.env.E2E_RUNTIME;
  } else {
    process.env.E2E_RUNTIME = originalE2eRuntime;
  }
});

describe("Google Ads provider boundary", () => {
  it("centralizes API v25", () => {
    expect(googleAdsApiVersion).toBe("v25");
  });

  it("discovers conversion actions read-only", () => {
    expect(googleAdsQueries.conversionActions).toMatch(/conversion_action\.id/);
    expect(googleAdsQueries.conversionActions).toMatch(
      /conversion_action\.counting_type/,
    );
    expect(googleAdsQueries.conversionActions).not.toMatch(/mutate|upload/i);
  });

  it("keeps metric queries read-only and conversion-free", () => {
    const hourly = googleAdsQueries.adHourlyMetrics(
      "2026-08-30",
      "2026-08-30",
      ["1001"],
    );
    expect(hourly).toMatch(/segments\.hour/);
    expect(hourly).not.toMatch(/mutate|uploadclick/i);
    expect(
      googleAdsQueries.landingPageDailyMetrics("2026-08-30", "2026-08-30"),
    ).not.toMatch(/segments\.hour/);
    const campaign = googleAdsQueries.campaignDailyPerformance(
      "2026-08-01",
      "2026-08-31",
    );
    expect(campaign).toMatch(/metrics\.cost_micros/);
    expect(campaign).not.toMatch(/campaign\.status = 'ENABLED'/);
    expect(campaign).not.toMatch(/mutate|upload/i);
    const clickView = googleAdsQueries.clickViews("2026-08-30", ["abc-123"]);
    expect(clickView).toMatch(/segments\.date = '2026-08-30'/);
    expect(clickView).toMatch(/click_view\.gclid IN \('abc-123'\)/);
  });

  it("exposes only read methods", () => {
    const provider = getGoogleAdsReadProvider();
    expect(Object.keys(provider).sort()).toEqual([
      "getAdHourlyMetrics",
      "getAssetGroupHourlyMetrics",
      "getCampaignDailyPerformance",
      "getClickViews",
      "getCustomer",
      "getCustomerDailyPerformance",
      "getCustomerHierarchy",
      "getExpandedLandingPageDailyMetrics",
      "getLandingPageDailyMetrics",
      "listAccessibleCustomers",
      "listConversionActions",
      "syncObservedLandingPages",
      "syncPerformanceMaxDestinations",
      "syncStandardAdDestinations",
    ]);
    expect(JSON.stringify(Object.keys(provider))).not.toMatch(
      /mutate|pause|upload|create|update|remove/i,
    );
  });

  it("rejects the fake provider in production", () => {
    const previous = process.env.E2E_RUNTIME;
    delete process.env.E2E_RUNTIME;
    process.env.GOOGLE_ADS_PROVIDER = "fake";
    expect(() =>
      assertFakeProviderNotUsedInProduction("production", {
        NODE_ENV: "production",
      }),
    ).toThrow(/fake/i);
    if (previous === undefined) delete process.env.E2E_RUNTIME;
    else process.env.E2E_RUNTIME = previous;
  });

  it("keeps the fake provider available for isolated E2E runtime", () => {
    process.env.GOOGLE_ADS_PROVIDER = "fake";
    expect(() =>
      assertFakeProviderNotUsedInProduction("production", {
        NODE_ENV: "production",
        E2E_RUNTIME: "true",
      }),
    ).not.toThrow();
  });
});
