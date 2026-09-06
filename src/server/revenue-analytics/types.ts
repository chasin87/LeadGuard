export type AnalyticsMetricStatus =
  | "COMPLETE"
  | "PARTIAL_REVENUE"
  | "PARTIAL_ATTRIBUTION"
  | "CURRENCY_MISMATCH"
  | "SPEND_UNAVAILABLE"
  | "STALE_SPEND"
  | "NO_SPEND"
  | "NO_DATA";

export type SpendFreshness = "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";

export type OutcomeStatus = "NEW" | "QUALIFIED" | "WON" | "LOST";

export type LeadResolutionStatus =
  | "PENDING"
  | "ACCOUNT_RESOLVED"
  | "CAMPAIGN_RESOLVED"
  | "UNSUPPORTED_IDENTIFIER"
  | "NOT_FOUND"
  | "OUTSIDE_LOOKBACK"
  | "AMBIGUOUS"
  | "ERROR";

export type CountMetric = {
  value: number;
  status: AnalyticsMetricStatus;
  reason: string | null;
};

export type MoneyMetric = {
  amountMinor: bigint | null;
  currencyCode: string | null;
  formatted: string | null;
  status: AnalyticsMetricStatus;
  reason: string | null;
};

export type RatioMetric = {
  timesHundredths: bigint | null;
  formatted: string | null;
  label: "Real ROAS" | "Known-revenue ROAS" | "ROAS unavailable";
  status: AnalyticsMetricStatus;
  reason: string | null;
  completeness: number | null;
};

export type CostMetric = {
  amountMinor: bigint | null;
  currencyCode: string | null;
  formatted: string | null;
  status: AnalyticsMetricStatus;
  reason: string | null;
};

export type RateMetric = {
  hundredths: bigint | null;
  formatted: string | null;
  status: AnalyticsMetricStatus;
  reason: string | null;
};

export type CurrencyBucket = {
  currencyCode: string;
  amountMinor: bigint;
  formatted: string;
  wonWithRevenue: number;
};

export type AnalyticsLeadInput = {
  leadId: string;
  websiteId: string;
  outcomeStatus: OutcomeStatus;
  revenueAmountMinor: bigint | null;
  revenueCurrencyCode: string | null;
  acquisitionCapturedAt: Date;
  googleClickDate: string | null;
  campaignId: string | null;
  campaignNameSnapshot: string | null;
  resolutionStatus: LeadResolutionStatus;
  wonAt: Date | null;
};

export type AnalyticsSpendRowInput = {
  date: string;
  dimensionType: "ACCOUNT" | "CAMPAIGN";
  campaignId: string;
  campaignNameSnapshot: string | null;
  campaignStatus: string | null;
  advertisingChannelType: string | null;
  costMicros: bigint;
  clicks: bigint;
  impressions: bigint;
  currencyCode: string;
};

export type ConversionFeedbackHealthInput = {
  succeeded: number;
  processing: number;
  needsAttention: number;
};

export type RevenueAnalyticsInput = {
  rangeFrom: string;
  rangeThrough: string;
  timeZone: string;
  spendCurrencyCode: string;
  now: Date;
  lastSpendSyncedAt: Date | null;
  spendFreshDelayedAfterHours: number;
  spendFreshStaleAfterHours: number;
  maturityWindowDays: number;
  websiteFilter: "ALL_MAPPED" | "SUBSET";
  spendRows: AnalyticsSpendRowInput[];
  leads: AnalyticsLeadInput[];
  feedback: ConversionFeedbackHealthInput;
};

export type CampaignAnalyticsRow = {
  campaignId: string;
  campaignName: string;
  advertisingChannelType: string | null;
  campaignStatus: string | null;
  spend: MoneyMetric;
  clicks: CountMetric;
  leads: CountMetric;
  won: CountMetric;
  revenue: MoneyMetric;
  costPerLead: CostMetric;
  costPerWon: CostMetric;
  roas: RatioMetric;
  anomaly: "NO_SPEND_WITH_REVENUE" | null;
};

export type UnresolvedCampaignRow = {
  leads: CountMetric;
  won: CountMetric;
  revenue: MoneyMetric;
};

export type DailyCohortPoint = {
  date: string;
  spendMinor: bigint | null;
  spendFormatted: string | null;
  revenueMinor: bigint | null;
  revenueFormatted: string | null;
};

export type DailyOutcomePoint = {
  date: string;
  revenueMinor: bigint | null;
  revenueFormatted: string | null;
};

export type RevenueAnalyticsResult = {
  statuses: AnalyticsMetricStatus[];
  spend: MoneyMetric;
  clicks: CountMetric;
  impressions: CountMetric;
  leads: CountMetric;
  qualified: CountMetric;
  won: CountMetric;
  lost: CountMetric;
  realizedRevenue: MoneyMetric;
  revenueByCurrency: CurrencyBucket[];
  costPerLead: CostMetric;
  costPerWon: CostMetric;
  realRoas: RatioMetric;
  winRate: RateMetric;
  leadToWinRate: RateMetric;
  leadConversionRate: RateMetric;
  knownRevenuePerLead: CostMetric;
  revenueCompleteness: {
    knownWon: number;
    totalWon: number;
    percent: number | null;
    status: AnalyticsMetricStatus;
  };
  campaignAttributionCoverage: {
    resolvedLeads: number;
    attributedLeads: number;
    percent: number | null;
    resolvedKnownRevenueMinor: bigint;
    accountKnownRevenueMinor: bigint;
    revenuePercent: number | null;
    status: AnalyticsMetricStatus;
  };
  campaigns: CampaignAnalyticsRow[];
  unresolved: UnresolvedCampaignRow;
  acquisitionTrend: DailyCohortPoint[];
  wonByOutcomeDate: DailyOutcomePoint[];
  feedback: ConversionFeedbackHealthInput;
  freshness: {
    spend: SpendFreshness;
    spendAsOf: Date | null;
    outcomesAsOf: "live";
  };
  maturity: {
    stillMaturing: boolean;
    newestAcquisitionDaysAgo: number | null;
    label: string | null;
  };
  spendScope: "ACCOUNT" | "WEBSITE_FILTER_EXCLUDED";
  reconciliation: {
    resolvedCampaignRevenueMinor: bigint;
    unresolvedRevenueMinor: bigint;
    accountRevenueMinor: bigint;
    matches: boolean;
  };
};
