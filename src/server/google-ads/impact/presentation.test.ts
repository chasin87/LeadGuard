import { describe, expect, it } from "vitest";
import { presentGoogleAdsImpact } from "@/server/google-ads/impact/presentation";

const base = {
  isProvisional: false,
  dataIncomplete: false,
  currencyCode: "EUR",
  windowCostMicros: 135_000_000n,
  windowClicksMilli: 22_500n,
  windowClicksEstimated: true,
  destinationDailyCostMicros: 240_000_000n,
  destinationDailyFrom: "2026-08-30",
  destinationDailyTo: "2026-08-30",
  totalRelevantSources: 4,
  attributedSources: 3,
  lastRefreshedAt: new Date("2026-08-30T20:00:00.000Z"),
  dataThrough: new Date("2026-08-30T20:00:00.000Z"),
  diagnosticCode: null as string | null,
};

describe("Google Ads impact presentation", () => {
  it("labels prorated hourly spend as estimated, never wasted revenue", () => {
    const view = presentGoogleAdsImpact({
      ...base,
      status: "AVAILABLE",
      attributionMethod: "SOURCE_HOURLY_PRORATED",
      confidence: "MEDIUM",
      totalRelevantSources: 1,
      attributedSources: 1,
    });
    expect(view.spendLabel).toBe("Estimated spend at risk");
    expect(view.spendValue).toBe("€135.00");
    expect(view.clicksValue).toBe("~22.5");
    expect(view.title).not.toMatch(/lost|wasted|revenue/i);
    expect(view.spendLabel).not.toMatch(/wasted|lost/i);
  });

  it("does not present daily landing-page spend as exact window spend", () => {
    const view = presentGoogleAdsImpact({
      ...base,
      status: "UNAVAILABLE",
      attributionMethod: "DESTINATION_REPORTED_DAILY",
      confidence: "UNAVAILABLE",
      windowCostMicros: null,
      windowClicksMilli: null,
      windowClicksEstimated: false,
      attributedSources: 0,
    });
    expect(view.unavailableReason).toBe(
      "Exact incident-window spend is unavailable.",
    );
    expect(view.dailyContext).toContain("Destination spend on incident date");
    expect(view.dailyContext).toContain("€240.00");
    expect(view.spendValue).toBeNull();
  });

  it("qualifies partial coverage instead of a full total", () => {
    const view = presentGoogleAdsImpact({
      ...base,
      status: "PARTIAL",
      attributionMethod: "MIXED",
      confidence: "LOW",
    });
    expect(view.spendLabel).toBe("Partial spend attribution");
    expect(view.spendValue).toBe("€135.00 attributed");
    expect(view.coverageLabel).toBe("3 / 4 sources");
  });

  it("does not show €0 while impact is still pending", () => {
    const view = presentGoogleAdsImpact({
      ...base,
      status: "PENDING",
      attributionMethod: "UNAVAILABLE",
      confidence: "UNAVAILABLE",
      windowCostMicros: null,
      windowClicksMilli: null,
      lastRefreshedAt: null,
      dataThrough: null,
      destinationDailyCostMicros: null,
      destinationDailyFrom: null,
      destinationDailyTo: null,
    });
    expect(view.unavailableReason).toBe(
      "Google Ads impact is still being calculated.",
    );
    expect(view.spendValue).toBeNull();
  });
});
