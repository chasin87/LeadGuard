import {
  clicksToMilli,
  prorateClicksMilli,
  prorateMicros,
} from "@/lib/google-ads/money";
import {
  enumerateZonedDates,
  overlapMs,
  zonedHourUtcRange,
} from "@/server/google-ads/impact/timezone";

export type ImpactSourceType = "AD_GROUP_AD" | "ASSET_GROUP";

export type ImpactCoverageStatus = "ATTRIBUTED" | "AMBIGUOUS" | "UNSUPPORTED";

export type ImpactAttributionMethod =
  | "SOURCE_HOURLY"
  | "SOURCE_HOURLY_PRORATED"
  | "DESTINATION_REPORTED_DAILY"
  | "MIXED"
  | "UNAVAILABLE";

export type ImpactConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";

export type ImpactStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR";

export type CalculatorSource = {
  sourceType: ImpactSourceType;
  sourceEntityId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string | null;
  adId: string | null;
  assetGroupId: string | null;
  uniqueNormalizedFinalUrls: string[];
  hasUrlExpansionToOtherDestination: boolean;
};

export type HourlyMetricBucket = {
  sourceType: ImpactSourceType;
  sourceEntityId: string;
  date: string;
  hour: number;
  clicks: bigint;
  costMicros: bigint;
  impressions: bigint;
};

export type DailyLandingPageMetric = {
  normalizedUrl: string;
  date: string;
  clicks: bigint;
  costMicros: bigint;
  impressions: bigint;
};

export type CalculateIncidentImpactInput = {
  windowStartedAt: Date;
  windowEndedAt: Date;
  timeZone: string;
  destinationNormalizedUrl: string;
  sources: CalculatorSource[];
  hourlyBuckets: HourlyMetricBucket[];
  dailyLandingPages: DailyLandingPageMetric[];
};

export type CalculatedImpactSource = {
  sourceType: ImpactSourceType;
  sourceEntityId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string | null;
  adId: string | null;
  assetGroupId: string | null;
  coverageStatus: ImpactCoverageStatus;
  method: ImpactAttributionMethod;
  confidence: ImpactConfidence;
  costMicros: bigint | null;
  clicksMilli: bigint | null;
  impressions: bigint | null;
};

export type CalculatedIncidentImpact = {
  status: ImpactStatus;
  attributionMethod: ImpactAttributionMethod;
  confidence: ImpactConfidence;
  windowCostMicros: bigint | null;
  windowClicksMilli: bigint | null;
  windowClicksEstimated: boolean;
  windowImpressions: bigint | null;
  destinationDailyCostMicros: bigint | null;
  destinationDailyClicks: bigint | null;
  destinationDailyImpressions: bigint | null;
  destinationDailyFrom: string | null;
  destinationDailyTo: string | null;
  totalRelevantSources: number;
  attributedSources: number;
  ambiguousSources: number;
  dataFrom: Date | null;
  dataThrough: Date | null;
  sources: CalculatedImpactSource[];
};

function classifySource(
  source: CalculatorSource,
  destinationNormalizedUrl: string,
): ImpactCoverageStatus {
  const unique = uniqueUrls(source.uniqueNormalizedFinalUrls);
  if (source.sourceType === "ASSET_GROUP") {
    return "AMBIGUOUS";
  }
  if (unique.length !== 1) return "AMBIGUOUS";
  if (unique[0] !== destinationNormalizedUrl) return "UNSUPPORTED";
  if (source.hasUrlExpansionToOtherDestination) return "AMBIGUOUS";
  return "ATTRIBUTED";
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sourceKey(sourceType: string, sourceEntityId: string): string {
  return `${sourceType}:${sourceEntityId}`;
}

export function calculateIncidentImpact(
  input: CalculateIncidentImpactInput,
): CalculatedIncidentImpact {
  const deduped = new Map<string, CalculatorSource>();
  for (const source of input.sources) {
    const key = sourceKey(source.sourceType, source.sourceEntityId);
    if (!deduped.has(key)) deduped.set(key, source);
  }
  const sources = [...deduped.values()];
  const classified = sources.map((source) => ({
    source,
    coverage: classifySource(source, input.destinationNormalizedUrl),
  }));

  const hourlyBySource = new Map<string, HourlyMetricBucket[]>();
  for (const bucket of input.hourlyBuckets) {
    const key = sourceKey(bucket.sourceType, bucket.sourceEntityId);
    const list = hourlyBySource.get(key) ?? [];
    list.push(bucket);
    hourlyBySource.set(key, list);
  }

  let windowCost = 0n;
  let windowClicksMilli = 0n;
  let windowImpressions = 0n;
  let anyProration = false;
  let anyFullHour = false;
  let dataFrom: Date | null = null;
  let dataThrough: Date | null = null;

  const resultSources: CalculatedImpactSource[] = classified.map(
    ({ source, coverage }) => {
      if (coverage !== "ATTRIBUTED") {
        return {
          sourceType: source.sourceType,
          sourceEntityId: source.sourceEntityId,
          campaignId: source.campaignId,
          campaignName: source.campaignName,
          adGroupId: source.adGroupId,
          adId: source.adId,
          assetGroupId: source.assetGroupId,
          coverageStatus: coverage,
          method: "UNAVAILABLE",
          confidence: "UNAVAILABLE",
          costMicros: null,
          clicksMilli: null,
          impressions: null,
        };
      }

      const buckets =
        hourlyBySource.get(
          sourceKey(source.sourceType, source.sourceEntityId),
        ) ?? [];
      let cost = 0n;
      let clicksMilli = 0n;
      let impressions = 0n;
      let sourceProrated = false;
      let sourceFull = false;

      for (const bucket of buckets) {
        const range = zonedHourUtcRange(
          input.timeZone,
          bucket.date,
          bucket.hour,
        );
        const bucketMs = BigInt(
          Math.max(0, range.end.getTime() - range.start.getTime()),
        );
        if (bucketMs <= 0n) continue;
        const overlap = BigInt(
          overlapMs(
            range.start,
            range.end,
            input.windowStartedAt,
            input.windowEndedAt,
          ),
        );
        if (overlap <= 0n) continue;
        if (overlap < bucketMs) sourceProrated = true;
        else sourceFull = true;
        cost += prorateMicros(bucket.costMicros, overlap, bucketMs);
        clicksMilli += prorateClicksMilli(bucket.clicks, overlap, bucketMs);
        impressions += prorateMicros(bucket.impressions, overlap, bucketMs);
        if (!dataFrom || range.start < dataFrom) dataFrom = range.start;
        if (!dataThrough || range.end > dataThrough) dataThrough = range.end;
      }

      anyProration = anyProration || sourceProrated;
      anyFullHour = anyFullHour || sourceFull;
      windowCost += cost;
      windowClicksMilli += clicksMilli;
      windowImpressions += impressions;

      const method: ImpactAttributionMethod = sourceProrated
        ? "SOURCE_HOURLY_PRORATED"
        : "SOURCE_HOURLY";
      const confidence: ImpactConfidence = sourceProrated ? "MEDIUM" : "HIGH";

      return {
        sourceType: source.sourceType,
        sourceEntityId: source.sourceEntityId,
        campaignId: source.campaignId,
        campaignName: source.campaignName,
        adGroupId: source.adGroupId,
        adId: source.adId,
        assetGroupId: source.assetGroupId,
        coverageStatus: "ATTRIBUTED",
        method,
        confidence,
        costMicros: cost,
        clicksMilli,
        impressions,
      };
    },
  );

  const incidentDates = enumerateZonedDates(
    input.windowStartedAt,
    input.windowEndedAt,
    input.timeZone,
  );
  const dailyMatches = input.dailyLandingPages.filter(
    (row) =>
      row.normalizedUrl === input.destinationNormalizedUrl &&
      incidentDates.includes(row.date),
  );
  let dailyCost: bigint | null = null;
  let dailyClicks: bigint | null = null;
  let dailyImpressions: bigint | null = null;
  let dailyFrom: string | null = null;
  let dailyTo: string | null = null;
  if (dailyMatches.length > 0) {
    dailyCost = 0n;
    dailyClicks = 0n;
    dailyImpressions = 0n;
    for (const row of dailyMatches) {
      dailyCost += row.costMicros;
      dailyClicks += row.clicks;
      dailyImpressions += row.impressions;
      if (!dailyFrom || row.date < dailyFrom) dailyFrom = row.date;
      if (!dailyTo || row.date > dailyTo) dailyTo = row.date;
    }
  }

  const totalRelevantSources = classified.filter(
    (item) => item.coverage !== "UNSUPPORTED",
  ).length;
  const attributedSources = classified.filter(
    (item) => item.coverage === "ATTRIBUTED",
  ).length;
  const ambiguousSources = classified.filter(
    (item) => item.coverage === "AMBIGUOUS",
  ).length;

  if (attributedSources === 0) {
    return {
      status: dailyCost != null ? "UNAVAILABLE" : "UNAVAILABLE",
      attributionMethod:
        dailyCost != null ? "DESTINATION_REPORTED_DAILY" : "UNAVAILABLE",
      confidence: "UNAVAILABLE",
      windowCostMicros: null,
      windowClicksMilli: null,
      windowClicksEstimated: false,
      windowImpressions: null,
      destinationDailyCostMicros: dailyCost,
      destinationDailyClicks: dailyClicks,
      destinationDailyImpressions: dailyImpressions,
      destinationDailyFrom: dailyFrom,
      destinationDailyTo: dailyTo,
      totalRelevantSources,
      attributedSources,
      ambiguousSources,
      dataFrom: null,
      dataThrough: null,
      sources: resultSources,
    };
  }

  const partial = ambiguousSources > 0;
  const windowClicksEstimated = anyProration;
  const attributionMethod: ImpactAttributionMethod = partial
    ? "MIXED"
    : anyProration
      ? "SOURCE_HOURLY_PRORATED"
      : "SOURCE_HOURLY";
  const confidence: ImpactConfidence = partial
    ? "LOW"
    : anyProration
      ? "MEDIUM"
      : anyFullHour
        ? "HIGH"
        : "MEDIUM";

  return {
    status: partial ? "PARTIAL" : "AVAILABLE",
    attributionMethod,
    confidence,
    windowCostMicros: windowCost,
    windowClicksMilli,
    windowClicksEstimated,
    windowImpressions,
    destinationDailyCostMicros: dailyCost,
    destinationDailyClicks: dailyClicks,
    destinationDailyImpressions: dailyImpressions,
    destinationDailyFrom: dailyFrom,
    destinationDailyTo: dailyTo,
    totalRelevantSources,
    attributedSources,
    ambiguousSources,
    dataFrom,
    dataThrough,
    sources: resultSources,
  };
}

export function emptyImpact(
  sources: CalculatorSource[],
  destinationNormalizedUrl: string,
): CalculatedIncidentImpact {
  return calculateIncidentImpact({
    windowStartedAt: new Date(0),
    windowEndedAt: new Date(0),
    timeZone: "UTC",
    destinationNormalizedUrl,
    sources,
    hourlyBuckets: [],
    dailyLandingPages: [],
  });
}

export { clicksToMilli };
