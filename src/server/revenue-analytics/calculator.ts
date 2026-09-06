import { formatMoney } from "@/lib/money";
import {
  addIsoDays,
  cohortDateForLead,
  compareIsoDate,
  daysBetweenIso,
  enumerateIsoDates,
  isoDateInRange,
  todayInTimeZone,
} from "@/server/revenue-analytics/dates";
import {
  costPerCount,
  formatPercent,
  formatTimes,
  rateHundredths,
  ratioTimesHundredths,
  spendMicrosToMinor,
} from "@/server/revenue-analytics/ratios";
import type {
  AnalyticsLeadInput,
  AnalyticsMetricStatus,
  CampaignAnalyticsRow,
  ConversionFeedbackHealthInput,
  CostMetric,
  CountMetric,
  CurrencyBucket,
  MoneyMetric,
  RateMetric,
  RatioMetric,
  RevenueAnalyticsInput,
  RevenueAnalyticsResult,
  SpendFreshness,
} from "@/server/revenue-analytics/types";

const CAMPAIGN_RESOLVED: AnalyticsLeadInput["resolutionStatus"] =
  "CAMPAIGN_RESOLVED";

function countMetric(
  value: number,
  status: AnalyticsMetricStatus = "COMPLETE",
  reason: string | null = null,
): CountMetric {
  return { value, status, reason };
}

function unavailableMoney(
  reason: string,
  status: AnalyticsMetricStatus,
): MoneyMetric {
  return {
    amountMinor: null,
    currencyCode: null,
    formatted: null,
    status,
    reason,
  };
}

function moneyMetric(
  amountMinor: bigint,
  currencyCode: string,
  status: AnalyticsMetricStatus = "COMPLETE",
  reason: string | null = null,
): MoneyMetric {
  return {
    amountMinor,
    currencyCode,
    formatted: formatMoney(amountMinor, currencyCode),
    status,
    reason,
  };
}

function unavailableCost(
  reason: string,
  status: AnalyticsMetricStatus,
): CostMetric {
  return {
    amountMinor: null,
    currencyCode: null,
    formatted: null,
    status,
    reason,
  };
}

function unavailableRatio(
  reason: string,
  status: AnalyticsMetricStatus,
  completeness: number | null = null,
): RatioMetric {
  return {
    timesHundredths: null,
    formatted: null,
    label: "ROAS unavailable",
    status,
    reason,
    completeness,
  };
}

function unavailableRate(
  reason: string,
  status: AnalyticsMetricStatus = "NO_DATA",
): RateMetric {
  return {
    hundredths: null,
    formatted: null,
    status,
    reason,
  };
}

function spendFreshness(
  lastSpendSyncedAt: Date | null,
  now: Date,
  delayedAfterHours: number,
  staleAfterHours: number,
): SpendFreshness {
  if (!lastSpendSyncedAt) return "UNAVAILABLE";
  const ageHours = (now.getTime() - lastSpendSyncedAt.getTime()) / 3_600_000;
  if (ageHours >= staleAfterHours) return "STALE";
  if (ageHours >= delayedAfterHours) return "DELAYED";
  return "FRESH";
}

function uniqueStatuses(
  statuses: AnalyticsMetricStatus[],
): AnalyticsMetricStatus[] {
  return [...new Set(statuses)];
}

function knownWonRevenue(lead: AnalyticsLeadInput): boolean {
  return (
    lead.outcomeStatus === "WON" &&
    lead.revenueAmountMinor !== null &&
    Boolean(lead.revenueCurrencyCode)
  );
}

function campaignResolved(lead: AnalyticsLeadInput): boolean {
  return (
    lead.resolutionStatus === CAMPAIGN_RESOLVED && Boolean(lead.campaignId)
  );
}

export function calculateRevenueAnalytics(
  input: RevenueAnalyticsInput,
): RevenueAnalyticsResult {
  const statuses: AnalyticsMetricStatus[] = [];
  const freshness = spendFreshness(
    input.lastSpendSyncedAt,
    input.now,
    input.spendFreshDelayedAfterHours,
    input.spendFreshStaleAfterHours,
  );
  if (freshness === "STALE") statuses.push("STALE_SPEND");
  if (freshness === "UNAVAILABLE") statuses.push("SPEND_UNAVAILABLE");

  const accountRows = input.spendRows.filter(
    (row) =>
      row.dimensionType === "ACCOUNT" &&
      isoDateInRange(row.date, input.rangeFrom, input.rangeThrough),
  );
  const campaignSpendRows = input.spendRows.filter(
    (row) =>
      row.dimensionType === "CAMPAIGN" &&
      isoDateInRange(row.date, input.rangeFrom, input.rangeThrough),
  );

  const spendCurrencies = new Set(
    [...accountRows, ...campaignSpendRows].map((row) => row.currencyCode),
  );
  if (spendCurrencies.size > 1) {
    statuses.push("CURRENCY_MISMATCH");
  }

  const hasSpendRows = accountRows.length > 0;
  const accountCostMicros = accountRows.reduce(
    (sum, row) => sum + row.costMicros,
    0n,
  );
  const accountClicks = accountRows.reduce((sum, row) => sum + row.clicks, 0n);
  const accountImpressions = accountRows.reduce(
    (sum, row) => sum + row.impressions,
    0n,
  );

  let spend: MoneyMetric;
  if (!hasSpendRows) {
    spend = unavailableMoney(
      "No Google Ads reported spend for this range.",
      "SPEND_UNAVAILABLE",
    );
    statuses.push("SPEND_UNAVAILABLE");
  } else if (accountCostMicros === 0n) {
    spend = moneyMetric(
      0n,
      input.spendCurrencyCode,
      "NO_SPEND",
      "No Google Ads spend reported",
    );
    statuses.push("NO_SPEND");
  } else {
    const spendStatus =
      freshness === "STALE"
        ? "STALE_SPEND"
        : input.websiteFilter === "SUBSET"
          ? "PARTIAL_ATTRIBUTION"
          : "COMPLETE";
    spend = moneyMetric(
      spendMicrosToMinor(accountCostMicros, input.spendCurrencyCode),
      input.spendCurrencyCode,
      spendStatus,
      input.websiteFilter === "SUBSET"
        ? "Spend is Google Ads reported account spend and is not allocated to the website filter."
        : freshness === "STALE"
          ? "Google Ads data is stale — reconnect required."
          : null,
    );
  }

  const clicks = countMetric(Number(accountClicks), spend.status, spend.reason);
  const impressions = countMetric(
    Number(accountImpressions),
    spend.status,
    spend.reason,
  );

  const cohortLeads = input.leads.filter((lead) => {
    const date = cohortDateForLead({
      acquisitionCapturedAt: lead.acquisitionCapturedAt,
      googleClickDate: lead.googleClickDate,
      timeZone: input.timeZone,
    });
    return isoDateInRange(date, input.rangeFrom, input.rangeThrough);
  });

  const qualifiedCount = cohortLeads.filter(
    (lead) => lead.outcomeStatus === "QUALIFIED",
  ).length;
  const wonLeads = cohortLeads.filter((lead) => lead.outcomeStatus === "WON");
  const lostCount = cohortLeads.filter(
    (lead) => lead.outcomeStatus === "LOST",
  ).length;
  const wonCount = wonLeads.length;
  const leadCount = cohortLeads.length;

  const leads = countMetric(leadCount);
  const qualified = countMetric(qualifiedCount);
  const won = countMetric(wonCount);
  const lost = countMetric(lostCount);

  const currencyTotals = new Map<
    string,
    { amountMinor: bigint; wonWithRevenue: number }
  >();
  let knownWon = 0;
  for (const lead of wonLeads) {
    if (!knownWonRevenue(lead)) continue;
    knownWon += 1;
    const code = lead.revenueCurrencyCode!;
    const current = currencyTotals.get(code) ?? {
      amountMinor: 0n,
      wonWithRevenue: 0,
    };
    current.amountMinor += lead.revenueAmountMinor!;
    current.wonWithRevenue += 1;
    currencyTotals.set(code, current);
  }

  const revenueByCurrency: CurrencyBucket[] = [...currencyTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, bucket]) => ({
      currencyCode,
      amountMinor: bucket.amountMinor,
      formatted: formatMoney(bucket.amountMinor, currencyCode),
      wonWithRevenue: bucket.wonWithRevenue,
    }));

  const completenessPercent =
    wonCount === 0 ? 100 : Math.floor((knownWon * 100) / wonCount);
  const revenueComplete = knownWon === wonCount;
  if (!revenueComplete && wonCount > 0) statuses.push("PARTIAL_REVENUE");

  const revenueCurrencies = [...currencyTotals.keys()];
  const currencyMismatch =
    revenueCurrencies.some((code) => code !== input.spendCurrencyCode) ||
    spendCurrencies.size > 1;
  if (currencyMismatch && revenueCurrencies.length > 0) {
    statuses.push("CURRENCY_MISMATCH");
  }

  const matchedCurrencyRevenue =
    currencyTotals.get(input.spendCurrencyCode)?.amountMinor ?? 0n;
  const matchedCurrencyKnownWon =
    currencyTotals.get(input.spendCurrencyCode)?.wonWithRevenue ?? 0;

  let realizedRevenue: MoneyMetric;
  if (wonCount === 0) {
    realizedRevenue = moneyMetric(0n, input.spendCurrencyCode);
  } else if (revenueCurrencies.length === 0) {
    realizedRevenue = unavailableMoney(
      "Won leads have unknown revenue.",
      "PARTIAL_REVENUE",
    );
  } else if (revenueCurrencies.length > 1 || currencyMismatch) {
    const display = revenueByCurrency[0];
    realizedRevenue = display
      ? moneyMetric(
          display.amountMinor,
          display.currencyCode,
          "CURRENCY_MISMATCH",
          "ROAS unavailable — currency mismatch",
        )
      : unavailableMoney(
          "ROAS unavailable — currency mismatch",
          "CURRENCY_MISMATCH",
        );
  } else if (!revenueComplete) {
    realizedRevenue = moneyMetric(
      matchedCurrencyRevenue,
      input.spendCurrencyCode,
      "PARTIAL_REVENUE",
      "Known realized revenue only. Some won leads have unknown revenue.",
    );
  } else {
    realizedRevenue = moneyMetric(
      matchedCurrencyRevenue,
      input.spendCurrencyCode,
    );
  }

  const spendMinor = spend.amountMinor;
  const spendAvailable =
    spendMinor !== null &&
    spend.status !== "SPEND_UNAVAILABLE" &&
    input.websiteFilter !== "SUBSET";

  function buildRoas(revenueMinor: bigint, complete: boolean): RatioMetric {
    if (input.websiteFilter === "SUBSET") {
      return unavailableRatio(
        "Website filter cannot be applied to Google Ads account spend.",
        "SPEND_UNAVAILABLE",
        completenessPercent,
      );
    }
    if (currencyMismatch) {
      return unavailableRatio(
        "ROAS unavailable — currency mismatch",
        "CURRENCY_MISMATCH",
        completenessPercent,
      );
    }
    if (!hasSpendRows) {
      return unavailableRatio(
        "No Google Ads reported spend for this range.",
        "SPEND_UNAVAILABLE",
        completenessPercent,
      );
    }
    if (accountCostMicros === 0n) {
      return unavailableRatio(
        "No Google Ads spend reported",
        "NO_SPEND",
        completenessPercent,
      );
    }
    const times = ratioTimesHundredths(revenueMinor, spendMinor!);
    if (times === null) {
      return unavailableRatio(
        "No Google Ads spend reported",
        "NO_SPEND",
        completenessPercent,
      );
    }
    if (!complete) {
      return {
        timesHundredths: times,
        formatted: formatTimes(times),
        label: "Known-revenue ROAS",
        status: "PARTIAL_REVENUE",
        reason: "Known-revenue ROAS. Revenue completeness is partial.",
        completeness: completenessPercent,
      };
    }
    return {
      timesHundredths: times,
      formatted: formatTimes(times),
      label: "Real ROAS",
      status: freshness === "STALE" ? "STALE_SPEND" : "COMPLETE",
      reason: null,
      completeness: 100,
    };
  }

  const realRoas = buildRoas(
    currencyMismatch ? 0n : matchedCurrencyRevenue,
    revenueComplete && !currencyMismatch,
  );

  function buildCost(count: number): CostMetric {
    if (!spendAvailable || spendMinor === null) {
      return unavailableCost(
        spend.reason ?? "Spend unavailable.",
        spend.status === "COMPLETE" ? "SPEND_UNAVAILABLE" : spend.status,
      );
    }
    if (count <= 0) {
      return unavailableCost("—", "NO_DATA");
    }
    const cost = costPerCount(spendMinor, count, input.spendCurrencyCode);
    return {
      amountMinor: cost!.amountMinor,
      currencyCode: input.spendCurrencyCode,
      formatted: cost!.formatted,
      status: spend.status,
      reason: null,
    };
  }

  const costPerLead = buildCost(leadCount);
  const costPerWon = buildCost(wonCount);

  const winDenom = wonCount + lostCount;
  const winRateHundredths = rateHundredths(wonCount, winDenom);
  const winRate: RateMetric =
    winRateHundredths === null
      ? unavailableRate("—")
      : {
          hundredths: winRateHundredths,
          formatted: formatPercent(winRateHundredths),
          status: "COMPLETE",
          reason: null,
        };
  const leadToWinHundredths = rateHundredths(wonCount, leadCount);
  const leadToWinRate: RateMetric =
    leadToWinHundredths === null
      ? unavailableRate("—")
      : {
          hundredths: leadToWinHundredths,
          formatted: formatPercent(leadToWinHundredths),
          status: "COMPLETE",
          reason: null,
        };
  const clickCount = Number(accountClicks);
  const leadConversionHundredths = rateHundredths(leadCount, clickCount);
  const leadConversionRate: RateMetric = !hasSpendRows
    ? unavailableRate("Clicks unavailable.", "SPEND_UNAVAILABLE")
    : leadConversionHundredths === null
      ? unavailableRate("—")
      : {
          hundredths: leadConversionHundredths,
          formatted: formatPercent(leadConversionHundredths),
          status: "COMPLETE",
          reason: null,
        };

  const knownRevenuePerLeadValue =
    leadCount > 0 && !currencyMismatch && matchedCurrencyKnownWon >= 0
      ? costPerCount(matchedCurrencyRevenue, leadCount, input.spendCurrencyCode)
      : null;
  const knownRevenuePerLead: CostMetric = currencyMismatch
    ? unavailableCost(
        "ROAS unavailable — currency mismatch",
        "CURRENCY_MISMATCH",
      )
    : knownRevenuePerLeadValue
      ? {
          amountMinor: knownRevenuePerLeadValue.amountMinor,
          currencyCode: input.spendCurrencyCode,
          formatted: knownRevenuePerLeadValue.formatted,
          status: revenueComplete ? "COMPLETE" : "PARTIAL_REVENUE",
          reason: revenueComplete ? null : "Known revenue / lead",
        }
      : unavailableCost("—", "NO_DATA");

  const resolvedLeads = cohortLeads.filter(campaignResolved);
  const coveragePercent =
    leadCount === 0
      ? 100
      : Math.floor((resolvedLeads.length * 100) / leadCount);
  if (leadCount > 0 && resolvedLeads.length < leadCount) {
    statuses.push("PARTIAL_ATTRIBUTION");
  }

  const accountKnownRevenueMinor = matchedCurrencyRevenue;
  let resolvedKnownRevenueMinor = 0n;
  for (const lead of wonLeads) {
    if (!campaignResolved(lead) || !knownWonRevenue(lead)) continue;
    if (lead.revenueCurrencyCode !== input.spendCurrencyCode) continue;
    resolvedKnownRevenueMinor += lead.revenueAmountMinor!;
  }
  const unresolvedWonRevenueMinor =
    accountKnownRevenueMinor - resolvedKnownRevenueMinor;

  const unresolvedLeads = cohortLeads.filter((lead) => !campaignResolved(lead));
  const unresolvedWon = unresolvedLeads.filter(
    (lead) => lead.outcomeStatus === "WON",
  );

  const campaignLeadMap = new Map<string, AnalyticsLeadInput[]>();
  for (const lead of resolvedLeads) {
    const id = lead.campaignId!;
    const list = campaignLeadMap.get(id) ?? [];
    list.push(lead);
    campaignLeadMap.set(id, list);
  }

  const campaignMeta = new Map<
    string,
    {
      name: string;
      status: string | null;
      type: string | null;
      costMicros: bigint;
      clicks: bigint;
    }
  >();
  const spendByCampaignDate = new Map<string, Map<string, bigint>>();
  for (const row of campaignSpendRows) {
    const current = campaignMeta.get(row.campaignId) ?? {
      name: row.campaignNameSnapshot ?? row.campaignId,
      status: row.campaignStatus,
      type: row.advertisingChannelType,
      costMicros: 0n,
      clicks: 0n,
    };
    current.costMicros += row.costMicros;
    current.clicks += row.clicks;
    if (row.campaignNameSnapshot) current.name = row.campaignNameSnapshot;
    if (row.campaignStatus) current.status = row.campaignStatus;
    if (row.advertisingChannelType) current.type = row.advertisingChannelType;
    campaignMeta.set(row.campaignId, current);
    const byDate = spendByCampaignDate.get(row.campaignId) ?? new Map();
    byDate.set(row.date, (byDate.get(row.date) ?? 0n) + row.costMicros);
    spendByCampaignDate.set(row.campaignId, byDate);
  }
  for (const [campaignId, list] of campaignLeadMap) {
    if (campaignMeta.has(campaignId)) continue;
    const named = list.find(
      (lead) => lead.campaignNameSnapshot,
    )?.campaignNameSnapshot;
    campaignMeta.set(campaignId, {
      name: named ?? campaignId,
      status: null,
      type: null,
      costMicros: 0n,
      clicks: 0n,
    });
  }

  const campaigns: CampaignAnalyticsRow[] = [...campaignMeta.entries()]
    .map(([campaignId, meta]) => {
      const list = campaignLeadMap.get(campaignId) ?? [];
      const campaignWon = list.filter((lead) => lead.outcomeStatus === "WON");
      const campaignKnownWon = campaignWon.filter(
        (lead) =>
          knownWonRevenue(lead) &&
          lead.revenueCurrencyCode === input.spendCurrencyCode,
      );
      const campaignRevenue = campaignKnownWon.reduce(
        (sum, lead) => sum + lead.revenueAmountMinor!,
        0n,
      );
      const campaignComplete = campaignWon.every(
        (lead) =>
          knownWonRevenue(lead) &&
          lead.revenueCurrencyCode === input.spendCurrencyCode,
      );
      const campaignSpendMinor = spendMicrosToMinor(
        meta.costMicros,
        input.spendCurrencyCode,
      );
      const hasCampaignSpendRow = campaignSpendRows.some(
        (row) => row.campaignId === campaignId,
      );
      const spendMetric: MoneyMetric = hasCampaignSpendRow
        ? moneyMetric(
            campaignSpendMinor,
            input.spendCurrencyCode,
            meta.costMicros === 0n ? "NO_SPEND" : "COMPLETE",
          )
        : unavailableMoney(
            "No Google Ads reported spend for this campaign in range.",
            "SPEND_UNAVAILABLE",
          );
      const attributionPartial = coveragePercent < 100 && leadCount > 0;
      let campaignRoas: RatioMetric;
      const anomaly =
        campaignRevenue > 0n && meta.costMicros === 0n
          ? ("NO_SPEND_WITH_REVENUE" as const)
          : null;
      if (anomaly) {
        campaignRoas = unavailableRatio(
          "ROAS unavailable — no Google Ads spend reported for this campaign.",
          "NO_SPEND",
        );
      } else if (!hasCampaignSpendRow) {
        campaignRoas = unavailableRatio(
          "No Google Ads reported spend for this campaign in range.",
          "SPEND_UNAVAILABLE",
        );
      } else if (currencyMismatch) {
        campaignRoas = unavailableRatio(
          "ROAS unavailable — currency mismatch",
          "CURRENCY_MISMATCH",
        );
      } else if (meta.costMicros === 0n) {
        campaignRoas = unavailableRatio(
          "No Google Ads spend reported",
          "NO_SPEND",
        );
      } else if (!campaignComplete && campaignWon.length > 0) {
        const times = ratioTimesHundredths(
          campaignRevenue,
          campaignSpendMinor,
        )!;
        campaignRoas = {
          timesHundredths: times,
          formatted: formatTimes(times),
          label: "Known-revenue ROAS",
          status: "PARTIAL_REVENUE",
          reason: "PARTIAL ATTRIBUTION",
          completeness:
            campaignWon.length === 0
              ? 100
              : Math.floor(
                  (campaignKnownWon.length * 100) / campaignWon.length,
                ),
        };
      } else {
        const times = ratioTimesHundredths(
          campaignRevenue,
          campaignSpendMinor,
        )!;
        campaignRoas = {
          timesHundredths: times,
          formatted: formatTimes(times),
          label: attributionPartial ? "Known-revenue ROAS" : "Real ROAS",
          status: attributionPartial ? "PARTIAL_ATTRIBUTION" : "COMPLETE",
          reason: attributionPartial ? "PARTIAL ATTRIBUTION" : null,
          completeness: 100,
        };
      }
      const cpl = costPerCount(
        campaignSpendMinor,
        list.length,
        input.spendCurrencyCode,
      );
      const cpw = costPerCount(
        campaignSpendMinor,
        campaignWon.length,
        input.spendCurrencyCode,
      );
      return {
        campaignId,
        campaignName: meta.name,
        advertisingChannelType: meta.type,
        campaignStatus: meta.status,
        spend: spendMetric,
        clicks: countMetric(Number(meta.clicks)),
        leads: countMetric(list.length),
        won: countMetric(campaignWon.length),
        revenue: moneyMetric(
          campaignRevenue,
          input.spendCurrencyCode,
          campaignComplete || campaignWon.length === 0
            ? attributionPartial
              ? "PARTIAL_ATTRIBUTION"
              : "COMPLETE"
            : "PARTIAL_REVENUE",
        ),
        costPerLead:
          cpl && hasCampaignSpendRow && meta.costMicros > 0n
            ? {
                amountMinor: cpl.amountMinor,
                currencyCode: input.spendCurrencyCode,
                formatted: cpl.formatted,
                status: "COMPLETE" as const,
                reason: null,
              }
            : unavailableCost("—", "NO_DATA"),
        costPerWon:
          cpw && hasCampaignSpendRow && meta.costMicros > 0n
            ? {
                amountMinor: cpw.amountMinor,
                currencyCode: input.spendCurrencyCode,
                formatted: cpw.formatted,
                status: "COMPLETE" as const,
                reason: null,
              }
            : unavailableCost("—", "NO_DATA"),
        roas: campaignRoas,
        anomaly,
      };
    })
    .sort((left, right) => {
      const leftSpend = left.spend.amountMinor ?? -1n;
      const rightSpend = right.spend.amountMinor ?? -1n;
      if (leftSpend === rightSpend) {
        return left.campaignName.localeCompare(right.campaignName);
      }
      return leftSpend < rightSpend ? 1 : -1;
    });

  const dates = enumerateIsoDates(input.rangeFrom, input.rangeThrough);
  const spendByDate = new Map<string, bigint>();
  for (const row of accountRows) {
    spendByDate.set(
      row.date,
      (spendByDate.get(row.date) ?? 0n) + row.costMicros,
    );
  }
  const revenueByAcquisition = new Map<string, bigint>();
  for (const lead of wonLeads) {
    if (
      !knownWonRevenue(lead) ||
      lead.revenueCurrencyCode !== input.spendCurrencyCode
    ) {
      continue;
    }
    const date = cohortDateForLead({
      acquisitionCapturedAt: lead.acquisitionCapturedAt,
      googleClickDate: lead.googleClickDate,
      timeZone: input.timeZone,
    });
    revenueByAcquisition.set(
      date,
      (revenueByAcquisition.get(date) ?? 0n) + lead.revenueAmountMinor!,
    );
  }
  const acquisitionTrend = dates.map((date) => {
    const daySpend = spendByDate.get(date);
    const dayRevenue = revenueByAcquisition.get(date) ?? 0n;
    return {
      date,
      spendMinor:
        daySpend === undefined
          ? null
          : spendMicrosToMinor(daySpend, input.spendCurrencyCode),
      spendFormatted:
        daySpend === undefined
          ? null
          : formatMoney(
              spendMicrosToMinor(daySpend, input.spendCurrencyCode),
              input.spendCurrencyCode,
            ),
      revenueMinor: dayRevenue,
      revenueFormatted: formatMoney(dayRevenue, input.spendCurrencyCode),
    };
  });

  const outcomeByDate = new Map<string, bigint>();
  for (const lead of input.leads) {
    if (
      lead.outcomeStatus !== "WON" ||
      !lead.wonAt ||
      !knownWonRevenue(lead) ||
      lead.revenueCurrencyCode !== input.spendCurrencyCode
    ) {
      continue;
    }
    const date = cohortDateForLead({
      acquisitionCapturedAt: lead.wonAt,
      googleClickDate: null,
      timeZone: input.timeZone,
    });
    if (!isoDateInRange(date, input.rangeFrom, input.rangeThrough)) continue;
    outcomeByDate.set(
      date,
      (outcomeByDate.get(date) ?? 0n) + lead.revenueAmountMinor!,
    );
  }
  const wonByOutcomeDate = dates.map((date) => ({
    date,
    revenueMinor: outcomeByDate.get(date) ?? 0n,
    revenueFormatted: formatMoney(
      outcomeByDate.get(date) ?? 0n,
      input.spendCurrencyCode,
    ),
  }));

  const today = todayInTimeZone(input.now, input.timeZone);
  let newestAcquisition: string | null = null;
  for (const lead of cohortLeads) {
    const date = cohortDateForLead({
      acquisitionCapturedAt: lead.acquisitionCapturedAt,
      googleClickDate: lead.googleClickDate,
      timeZone: input.timeZone,
    });
    if (!newestAcquisition || compareIsoDate(date, newestAcquisition) > 0) {
      newestAcquisition = date;
    }
  }
  const newestAcquisitionDaysAgo =
    newestAcquisition === null
      ? null
      : Math.max(0, daysBetweenIso(newestAcquisition, today));
  const stillMaturing =
    newestAcquisitionDaysAgo !== null &&
    newestAcquisitionDaysAgo <= input.maturityWindowDays;

  const unresolvedRevenueMetric =
    currencyMismatch && unresolvedWonRevenueMinor === 0n
      ? unavailableMoney(
          "ROAS unavailable — currency mismatch",
          "CURRENCY_MISMATCH",
        )
      : moneyMetric(
          unresolvedWonRevenueMinor < 0n ? 0n : unresolvedWonRevenueMinor,
          input.spendCurrencyCode,
          coveragePercent < 100 && leadCount > 0
            ? "PARTIAL_ATTRIBUTION"
            : "COMPLETE",
        );

  return {
    statuses: uniqueStatuses(statuses),
    spend,
    clicks,
    impressions,
    leads,
    qualified,
    won,
    lost,
    realizedRevenue,
    revenueByCurrency,
    costPerLead,
    costPerWon,
    realRoas,
    winRate,
    leadToWinRate,
    leadConversionRate,
    knownRevenuePerLead,
    revenueCompleteness: {
      knownWon,
      totalWon: wonCount,
      percent: wonCount === 0 ? 100 : completenessPercent,
      status: revenueComplete ? "COMPLETE" : "PARTIAL_REVENUE",
    },
    campaignAttributionCoverage: {
      resolvedLeads: resolvedLeads.length,
      attributedLeads: leadCount,
      percent: leadCount === 0 ? 100 : coveragePercent,
      resolvedKnownRevenueMinor,
      accountKnownRevenueMinor,
      revenuePercent:
        accountKnownRevenueMinor === 0n
          ? 100
          : Number(
              (resolvedKnownRevenueMinor * 100n) / accountKnownRevenueMinor,
            ),
      status:
        leadCount === 0 || resolvedLeads.length === leadCount
          ? "COMPLETE"
          : "PARTIAL_ATTRIBUTION",
    },
    campaigns,
    unresolved: {
      leads: countMetric(unresolvedLeads.length),
      won: countMetric(unresolvedWon.length),
      revenue: unresolvedRevenueMetric,
    },
    acquisitionTrend,
    wonByOutcomeDate,
    feedback: input.feedback,
    freshness: {
      spend: freshness,
      spendAsOf: input.lastSpendSyncedAt,
      outcomesAsOf: "live",
    },
    maturity: {
      stillMaturing,
      newestAcquisitionDaysAgo,
      label:
        newestAcquisitionDaysAgo === null
          ? null
          : newestAcquisitionDaysAgo === 0
            ? "Newest acquisition: today"
            : `Newest acquisition: ${newestAcquisitionDaysAgo} day${newestAcquisitionDaysAgo === 1 ? "" : "s"} ago`,
    },
    spendScope:
      input.websiteFilter === "SUBSET" ? "WEBSITE_FILTER_EXCLUDED" : "ACCOUNT",
    reconciliation: {
      resolvedCampaignRevenueMinor: resolvedKnownRevenueMinor,
      unresolvedRevenueMinor:
        unresolvedWonRevenueMinor < 0n ? 0n : unresolvedWonRevenueMinor,
      accountRevenueMinor: accountKnownRevenueMinor,
      matches:
        resolvedKnownRevenueMinor +
          (unresolvedWonRevenueMinor < 0n ? 0n : unresolvedWonRevenueMinor) ===
        accountKnownRevenueMinor,
    },
  };
}

export function emptyFeedback(): ConversionFeedbackHealthInput {
  return { succeeded: 0, processing: 0, needsAttention: 0 };
}

export function shiftRangePreset(
  preset: "7" | "30" | "90",
  today: string,
): { from: string; through: string } {
  const days = Number(preset);
  return {
    from: addIsoDays(today, -(days - 1)),
    through: today,
  };
}
