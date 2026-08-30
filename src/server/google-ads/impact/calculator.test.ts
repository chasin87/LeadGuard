import { describe, expect, it } from "vitest";
import { calculateIncidentImpact } from "@/server/google-ads/impact/calculator";
import { zonedLocalToUtc } from "@/server/google-ads/impact/timezone";

const destination = "https://example.nl/airco";

function window() {
  return {
    windowStartedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 15),
    windowEndedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 15, 45),
    timeZone: "Europe/Amsterdam",
    destinationNormalizedUrl: destination,
  };
}

function ad(
  id: string,
  urls: string[],
  extra?: Partial<
    Parameters<typeof calculateIncidentImpact>[0]["sources"][number]
  >,
) {
  return {
    sourceType: "AD_GROUP_AD" as const,
    sourceEntityId: id,
    campaignId: "100",
    campaignName: "Airco Amsterdam",
    adGroupId: "200",
    adId: id,
    assetGroupId: null,
    uniqueNormalizedFinalUrls: urls,
    hasUrlExpansionToOtherDestination: false,
    ...extra,
  };
}

describe("incident impact calculator", () => {
  it("uses startedAt→resolvedAt style windows via the supplied dates", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [ad("1001", [destination])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 14,
          clicks: 10n,
          costMicros: 60_000_000n,
          impressions: 100n,
        },
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 15,
          clicks: 20n,
          costMicros: 120_000_000n,
          impressions: 200n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.windowCostMicros).toBe(135_000_000n);
    expect(result.windowClicksMilli).toBe(22_500n);
    expect(result.windowClicksEstimated).toBe(true);
    expect(result.attributionMethod).toBe("SOURCE_HOURLY_PRORATED");
    expect(result.confidence).toBe("MEDIUM");
    expect(result.status).toBe("AVAILABLE");
  });

  it("does not prorate full hour buckets", () => {
    const result = calculateIncidentImpact({
      windowStartedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 0),
      windowEndedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 16, 0),
      timeZone: "Europe/Amsterdam",
      destinationNormalizedUrl: destination,
      sources: [ad("1001", [destination])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 14,
          clicks: 10n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 15,
          clicks: 20n,
          costMicros: 120_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.windowCostMicros).toBe(180_000_000n);
    expect(result.windowClicksEstimated).toBe(false);
    expect(result.attributionMethod).toBe("SOURCE_HOURLY");
    expect(result.confidence).toBe("HIGH");
  });

  it("never labels daily landing-page spend as exact incident-window spend", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [
        {
          sourceType: "ASSET_GROUP",
          sourceEntityId: "600",
          campaignId: "500",
          campaignName: "Performance Max – Airco",
          adGroupId: null,
          adId: null,
          assetGroupId: "600",
          uniqueNormalizedFinalUrls: [
            destination,
            "https://example.nl/airco-mobile",
          ],
          hasUrlExpansionToOtherDestination: true,
        },
      ],
      hourlyBuckets: [],
      dailyLandingPages: [
        {
          normalizedUrl: destination,
          date: "2026-08-30",
          clicks: 80n,
          costMicros: 240_100_000n,
          impressions: 900n,
        },
      ],
    });
    expect(result.windowCostMicros).toBeNull();
    expect(result.attributionMethod).toBe("DESTINATION_REPORTED_DAILY");
    expect(result.destinationDailyCostMicros).toBe(240_100_000n);
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("does not assign multi-URL ad spend to one destination", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [ad("1009", [destination, "https://example.nl/warmtepomp"])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1009",
          date: "2026-08-30",
          hour: 14,
          clicks: 10n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.windowCostMicros).toBeNull();
    expect(result.sources[0]?.coverageStatus).toBe("AMBIGUOUS");
    expect(result.ambiguousSources).toBe(1);
  });

  it("dedupes the same ad referenced twice", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [ad("1001", [destination]), ad("1001", [destination])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 14,
          clicks: 10n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 15,
          clicks: 20n,
          costMicros: 120_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.totalRelevantSources).toBe(1);
    expect(result.windowCostMicros).toBe(135_000_000n);
  });

  it("sums distinct ads to the same destination", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [ad("1001", [destination]), ad("1002", [destination])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 14,
          clicks: 10n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1002",
          date: "2026-08-30",
          hour: 15,
          clicks: 20n,
          costMicros: 120_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.windowCostMicros).toBe(135_000_000n);
    expect(result.attributedSources).toBe(2);
  });

  it("treats Performance Max hourly as ambiguous", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [
        {
          sourceType: "ASSET_GROUP",
          sourceEntityId: "600",
          campaignId: "500",
          campaignName: "PMax",
          adGroupId: null,
          adId: null,
          assetGroupId: "600",
          uniqueNormalizedFinalUrls: [destination],
          hasUrlExpansionToOtherDestination: false,
        },
      ],
      hourlyBuckets: [
        {
          sourceType: "ASSET_GROUP",
          sourceEntityId: "600",
          date: "2026-08-30",
          hour: 14,
          clicks: 50n,
          costMicros: 500_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.windowCostMicros).toBeNull();
    expect(result.sources[0]?.coverageStatus).toBe("AMBIGUOUS");
  });

  it("marks partial coverage when some sources are ambiguous", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [
        ad("1001", [destination]),
        ad("1002", [destination]),
        ad("1003", [destination]),
        ad("1009", [destination, "https://example.nl/warmtepomp"]),
        {
          sourceType: "ASSET_GROUP",
          sourceEntityId: "600",
          campaignId: "500",
          campaignName: "PMax",
          adGroupId: null,
          adId: null,
          assetGroupId: "600",
          uniqueNormalizedFinalUrls: [destination],
          hasUrlExpansionToOtherDestination: true,
        },
      ],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 14,
          clicks: 4n,
          costMicros: 20_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [],
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.attributedSources).toBe(3);
    expect(result.ambiguousSources).toBe(2);
    expect(result.totalRelevantSources).toBe(5);
    expect(result.attributionMethod).toBe("MIXED");
  });

  it("treats reported zero as AVAILABLE", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [ad("1001", [destination])],
      hourlyBuckets: [],
      dailyLandingPages: [],
    });
    expect(result.status).toBe("AVAILABLE");
    expect(result.windowCostMicros).toBe(0n);
    expect(result.windowClicksMilli).toBe(0n);
  });

  it("does not add daily destination spend to hourly window spend", () => {
    const result = calculateIncidentImpact({
      ...window(),
      sources: [ad("1001", [destination])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 14,
          clicks: 10n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 15,
          clicks: 20n,
          costMicros: 120_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [
        {
          normalizedUrl: destination,
          date: "2026-08-30",
          clicks: 80n,
          costMicros: 240_000_000n,
          impressions: 0n,
        },
      ],
    });
    expect(result.windowCostMicros).toBe(135_000_000n);
    expect(result.destinationDailyCostMicros).toBe(240_000_000n);
  });

  it("supports multi-day timezone-aware windows", () => {
    const result = calculateIncidentImpact({
      windowStartedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 22, 20),
      windowEndedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 9, 1, 8, 10),
      timeZone: "Europe/Amsterdam",
      destinationNormalizedUrl: destination,
      sources: [ad("1001", [destination])],
      hourlyBuckets: [
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-08-30",
          hour: 22,
          clicks: 6n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
        {
          sourceType: "AD_GROUP_AD",
          sourceEntityId: "1001",
          date: "2026-09-01",
          hour: 7,
          clicks: 6n,
          costMicros: 60_000_000n,
          impressions: 0n,
        },
      ],
      dailyLandingPages: [
        {
          normalizedUrl: destination,
          date: "2026-08-31",
          clicks: 1n,
          costMicros: 1_000_000n,
          impressions: 0n,
        },
      ],
    });
    expect(result.destinationDailyFrom).toBe("2026-08-31");
    expect(result.windowCostMicros).toBeGreaterThan(0n);
  });
});
