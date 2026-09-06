import { describe, expect, it } from "vitest";
import { calculateRevenueAnalytics } from "@/server/revenue-analytics/calculator";
import { spendMicrosToMinor } from "@/server/revenue-analytics/ratios";
import type {
  AnalyticsLeadInput,
  AnalyticsSpendRowInput,
  RevenueAnalyticsInput,
} from "@/server/revenue-analytics/types";

const now = new Date("2026-08-31T12:00:00.000Z");

function spendRow(
  date: string,
  costMicros: bigint,
  clicks: bigint,
  extra?: Partial<AnalyticsSpendRowInput>,
): AnalyticsSpendRowInput {
  return {
    date,
    dimensionType: "ACCOUNT",
    campaignId: "",
    campaignNameSnapshot: null,
    campaignStatus: null,
    advertisingChannelType: null,
    costMicros,
    clicks,
    impressions: clicks * 10n,
    currencyCode: "EUR",
    ...extra,
  };
}

function campaignSpend(
  date: string,
  campaignId: string,
  name: string,
  costMicros: bigint,
  clicks: bigint,
  extra?: Partial<AnalyticsSpendRowInput>,
): AnalyticsSpendRowInput {
  return spendRow(date, costMicros, clicks, {
    dimensionType: "CAMPAIGN",
    campaignId,
    campaignNameSnapshot: name,
    campaignStatus: extra?.campaignStatus ?? "ENABLED",
    advertisingChannelType: extra?.advertisingChannelType ?? "SEARCH",
    ...extra,
  });
}

function lead(
  partial: Partial<AnalyticsLeadInput> & Pick<AnalyticsLeadInput, "leadId">,
): AnalyticsLeadInput {
  return {
    websiteId: "site-a",
    outcomeStatus: "NEW",
    revenueAmountMinor: null,
    revenueCurrencyCode: null,
    acquisitionCapturedAt: new Date("2026-08-15T10:00:00.000Z"),
    googleClickDate: null,
    campaignId: null,
    campaignNameSnapshot: null,
    resolutionStatus: "ACCOUNT_RESOLVED",
    wonAt: null,
    ...partial,
  };
}

function baseInput(
  extra: Partial<RevenueAnalyticsInput> = {},
): RevenueAnalyticsInput {
  return {
    rangeFrom: "2026-08-01",
    rangeThrough: "2026-08-31",
    timeZone: "Europe/Amsterdam",
    spendCurrencyCode: "EUR",
    now,
    lastSpendSyncedAt: now,
    spendFreshDelayedAfterHours: 3,
    spendFreshStaleAfterHours: 24,
    maturityWindowDays: 14,
    websiteFilter: "ALL_MAPPED",
    spendRows: [],
    leads: [],
    feedback: { succeeded: 0, processing: 0, needsAttention: 0 },
    ...extra,
  };
}

describe("calculateRevenueAnalytics", () => {
  it("converts cost_micros without float drift", () => {
    expect(spendMicrosToMinor(1_000_000_000n, "EUR")).toBe(100_000n);
    expect(spendMicrosToMinor(82_370_000n, "EUR")).toBe(8_237n);
  });

  it("computes Real ROAS 5.00x for €10,000 spend and €50,000 revenue", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [
          spendRow("2026-08-15", 10_000_000_000n, 1000n),
          campaignSpend(
            "2026-08-15",
            "123",
            "Campaign A",
            10_000_000_000n,
            1000n,
          ),
        ],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 5_000_000n,
            revenueCurrencyCode: "EUR",
            campaignId: "123",
            resolutionStatus: "CAMPAIGN_RESOLVED",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.spend.formatted).toBe("€10,000.00");
    expect(result.realizedRevenue.formatted).toBe("€50,000.00");
    expect(result.realRoas.label).toBe("Real ROAS");
    expect(result.realRoas.formatted).toBe("5.00x");
    expect(result.realRoas.status).toBe("COMPLETE");
  });

  it("does not calculate ROAS on EUR spend and USD revenue", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [spendRow("2026-08-15", 1_000_000_000n, 10n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 5_000_00n,
            revenueCurrencyCode: "USD",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.realRoas.status).toBe("CURRENCY_MISMATCH");
    expect(result.realRoas.label).toBe("ROAS unavailable");
    expect(result.realRoas.reason).toMatch(/currency mismatch/i);
    expect(result.revenueByCurrency.map((row) => row.currencyCode)).toEqual([
      "USD",
    ]);
  });

  it("labels partial known-revenue ROAS when some won leads lack revenue", () => {
    const won = Array.from({ length: 10 }, (_, index) =>
      lead({
        leadId: `w${index}`,
        outcomeStatus: "WON",
        revenueAmountMinor: index < 8 ? 100_00n : null,
        revenueCurrencyCode: index < 8 ? "EUR" : null,
        campaignId: "123",
        resolutionStatus: "CAMPAIGN_RESOLVED",
        wonAt: new Date("2026-08-20T10:00:00.000Z"),
      }),
    );
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [
          spendRow("2026-08-15", 1_000_000_000n, 100n),
          campaignSpend("2026-08-15", "123", "A", 1_000_000_000n, 100n),
        ],
        leads: won,
      }),
    );
    expect(result.revenueCompleteness).toEqual({
      knownWon: 8,
      totalWon: 10,
      percent: 80,
      status: "PARTIAL_REVENUE",
    });
    expect(result.realRoas.label).toBe("Known-revenue ROAS");
    expect(result.realRoas.status).toBe("PARTIAL_REVENUE");
    expect(result.realRoas.formatted).toBe("0.80x");
  });

  it("treats explicit zero revenue as complete Real ROAS 0.00x", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [spendRow("2026-08-15", 1_000_000_000n, 10n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 0n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.realRoas.label).toBe("Real ROAS");
    expect(result.realRoas.formatted).toBe("0.00x");
    expect(result.revenueCompleteness.status).toBe("COMPLETE");
  });

  it("does not produce infinity when spend is zero", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [spendRow("2026-08-15", 0n, 0n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 5_000_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.realRoas.formatted).toBeNull();
    expect(result.realRoas.status).toBe("NO_SPEND");
    expect(result.realRoas.reason).toMatch(/No Google Ads spend reported/);
  });

  it("attributes won revenue to the acquisition cohort, not the won date", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        rangeFrom: "2026-01-01",
        rangeThrough: "2026-01-31",
        spendRows: [spendRow("2026-01-01", 1_000_000_000n, 10n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 5_000_00n,
            revenueCurrencyCode: "EUR",
            acquisitionCapturedAt: new Date("2026-01-01T12:00:00.000Z"),
            wonAt: new Date("2026-02-01T12:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.realizedRevenue.formatted).toBe("€5,000.00");
    expect(
      result.acquisitionTrend.find((row) => row.date === "2026-01-01")
        ?.revenueFormatted,
    ).toBe("€5,000.00");
    expect(
      result.wonByOutcomeDate.every((row) => row.revenueMinor === 0n),
    ).toBe(true);
  });

  it("reports the same revenue on the won-date view in February", () => {
    const leadRow = lead({
      leadId: "1",
      outcomeStatus: "WON",
      revenueAmountMinor: 5_000_00n,
      revenueCurrencyCode: "EUR",
      acquisitionCapturedAt: new Date("2026-01-01T12:00:00.000Z"),
      wonAt: new Date("2026-02-01T12:00:00.000Z"),
    });
    const february = calculateRevenueAnalytics(
      baseInput({
        rangeFrom: "2026-02-01",
        rangeThrough: "2026-02-28",
        spendRows: [spendRow("2026-02-01", 1_000_000n, 1n)],
        leads: [leadRow],
      }),
    );
    expect(february.realizedRevenue.amountMinor).toBe(0n);
    expect(
      february.wonByOutcomeDate.find((row) => row.date === "2026-02-01")
        ?.revenueFormatted,
    ).toBe("€5,000.00");
  });

  it("converts UTC acquisition time into the Ads customer local date", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        rangeFrom: "2026-09-01",
        rangeThrough: "2026-09-01",
        spendRows: [spendRow("2026-09-01", 1_000_000n, 1n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 100_00n,
            revenueCurrencyCode: "EUR",
            acquisitionCapturedAt: new Date("2026-08-31T23:30:00.000Z"),
            wonAt: new Date("2026-09-02T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.leads.value).toBe(1);
    expect(result.realizedRevenue.formatted).toBe("€100.00");
  });

  it("handles Europe/Amsterdam spring-forward DST", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        rangeFrom: "2026-03-29",
        rangeThrough: "2026-03-29",
        spendRows: [spendRow("2026-03-29", 1_000_000n, 1n)],
        leads: [
          lead({
            leadId: "1",
            acquisitionCapturedAt: new Date("2026-03-28T23:30:00.000Z"),
            outcomeStatus: "WON",
            revenueAmountMinor: 10_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-04-01T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.leads.value).toBe(1);
  });

  it("handles Europe/Amsterdam fall-back DST", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        rangeFrom: "2026-10-25",
        rangeThrough: "2026-10-25",
        spendRows: [spendRow("2026-10-25", 1_000_000n, 1n)],
        leads: [
          lead({
            leadId: "1",
            acquisitionCapturedAt: new Date("2026-10-24T23:30:00.000Z"),
            outcomeStatus: "WON",
            revenueAmountMinor: 10_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-11-01T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.leads.value).toBe(1);
  });

  it("prefers the exact Google click date for cohort matching", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        rangeFrom: "2026-08-10",
        rangeThrough: "2026-08-10",
        spendRows: [spendRow("2026-08-10", 1_000_000n, 1n)],
        leads: [
          lead({
            leadId: "1",
            acquisitionCapturedAt: new Date("2026-08-15T10:00:00.000Z"),
            googleClickDate: "2026-08-10",
            outcomeStatus: "WON",
            revenueAmountMinor: 50_00n,
            revenueCurrencyCode: "EUR",
            campaignId: "123",
            resolutionStatus: "CAMPAIGN_RESOLVED",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.leads.value).toBe(1);
    expect(result.realizedRevenue.formatted).toBe("€50.00");
  });

  it("keeps unresolved campaign revenue out of campaign rows", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [
          spendRow("2026-08-15", 1_000_000_000n, 100n),
          campaignSpend("2026-08-15", "123", "Resolved", 1_000_000_000n, 100n),
        ],
        leads: [
          lead({
            leadId: "resolved",
            outcomeStatus: "WON",
            revenueAmountMinor: 3_000_00n,
            revenueCurrencyCode: "EUR",
            campaignId: "123",
            campaignNameSnapshot: "Resolved",
            resolutionStatus: "CAMPAIGN_RESOLVED",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
          lead({
            leadId: "open",
            outcomeStatus: "WON",
            revenueAmountMinor: 2_000_00n,
            revenueCurrencyCode: "EUR",
            resolutionStatus: "NOT_FOUND",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.realizedRevenue.formatted).toBe("€5,000.00");
    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]?.revenue.formatted).toBe("€3,000.00");
    expect(result.unresolved.leads.value).toBe(1);
    expect(result.unresolved.revenue.formatted).toBe("€2,000.00");
    expect(result.reconciliation.matches).toBe(true);
    expect(result.campaignAttributionCoverage.percent).toBe(50);
    expect(result.campaigns[0]?.roas.status).toBe("PARTIAL_ATTRIBUTION");
  });

  it("uses campaignId identity after a rename", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [
          spendRow("2026-08-15", 1_000_000_000n, 10n),
          campaignSpend("2026-08-01", "123", "Old Name", 400_000_000n, 4n),
          campaignSpend("2026-08-15", "123", "New Name", 600_000_000n, 6n),
        ],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 1_000_00n,
            revenueCurrencyCode: "EUR",
            campaignId: "123",
            campaignNameSnapshot: "Old Name",
            resolutionStatus: "CAMPAIGN_RESOLVED",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]?.campaignId).toBe("123");
    expect(result.campaigns[0]?.campaignName).toBe("New Name");
    expect(result.campaigns[0]?.spend.formatted).toBe("€1,000.00");
  });

  it("keeps paused and removed campaign spend visible", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [
          spendRow("2026-08-15", 300_000_000n, 3n),
          campaignSpend("2026-08-15", "101", "Paused", 100_000_000n, 1n, {
            campaignStatus: "PAUSED",
          }),
          campaignSpend("2026-08-15", "104", "Removed", 200_000_000n, 2n, {
            campaignStatus: "REMOVED",
          }),
        ],
        leads: [],
      }),
    );
    expect(result.campaigns.map((row) => row.campaignId).sort()).toEqual([
      "101",
      "104",
    ]);
    expect(
      result.campaigns.find((row) => row.campaignId === "104")?.spend.formatted,
    ).toBe("€200.00");
  });

  it("does not double-count account spend rows", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [
          spendRow("2026-08-15", 1_000_000_000n, 100n),
          spendRow("2026-08-16", 500_000_000n, 50n),
        ],
        leads: [],
      }),
    );
    expect(result.spend.formatted).toBe("€1,500.00");
    expect(result.clicks.value).toBe(150);
  });

  it("computes cost per lead and cost per won without float division", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [spendRow("2026-08-15", 1_000_000_000n, 100n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 3_000_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
          lead({ leadId: "2", outcomeStatus: "LOST" }),
          lead({
            leadId: "3",
            outcomeStatus: "WON",
            revenueAmountMinor: 2_000_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-08-21T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.leads.value).toBe(3);
    expect(result.won.value).toBe(2);
    expect(result.costPerLead.formatted).toBe("€333.33");
    expect(result.costPerWon.formatted).toBe("€500.00");
    expect(result.realRoas.formatted).toBe("5.00x");
    expect(result.winRate.formatted).toBe("66.66%");
  });

  it("excludes current LOST revenue after a WON → LOST correction", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [spendRow("2026-08-15", 1_000_000_000n, 10n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "LOST",
            revenueAmountMinor: null,
            revenueCurrencyCode: null,
          }),
        ],
      }),
    );
    expect(result.realizedRevenue.formatted).toBe("€0.00");
    expect(result.won.value).toBe(0);
  });

  it("keeps conversion feedback health independent of realized revenue", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        spendRows: [spendRow("2026-08-15", 1_000_000_000n, 10n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 4_500_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
        feedback: { succeeded: 0, processing: 0, needsAttention: 3 },
      }),
    );
    expect(result.realizedRevenue.formatted).toBe("€4,500.00");
    expect(result.realRoas.label).toBe("Real ROAS");
    expect(result.feedback.needsAttention).toBe(3);
  });

  it("marks spend unavailable when no daily rows exist", () => {
    const result = calculateRevenueAnalytics(baseInput({ spendRows: [] }));
    expect(result.spend.status).toBe("SPEND_UNAVAILABLE");
    expect(result.spend.amountMinor).toBeNull();
    expect(result.realRoas.status).toBe("SPEND_UNAVAILABLE");
  });

  it("does not apply account spend to a website subset filter", () => {
    const result = calculateRevenueAnalytics(
      baseInput({
        websiteFilter: "SUBSET",
        spendRows: [spendRow("2026-08-15", 1_000_000_000n, 10n)],
        leads: [
          lead({
            leadId: "1",
            outcomeStatus: "WON",
            revenueAmountMinor: 1_000_00n,
            revenueCurrencyCode: "EUR",
            wonAt: new Date("2026-08-20T10:00:00.000Z"),
          }),
        ],
      }),
    );
    expect(result.spendScope).toBe("WEBSITE_FILTER_EXCLUDED");
    expect(result.realRoas.status).toBe("SPEND_UNAVAILABLE");
    expect(result.realizedRevenue.formatted).toBe("€1,000.00");
  });
});
