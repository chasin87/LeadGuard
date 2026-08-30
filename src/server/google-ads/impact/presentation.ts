import {
  formatCurrencyFromMicros,
  formatEstimatedClicks,
  formatReportedClicks,
} from "@/lib/google-ads/money";
import { formatRelativeTime } from "@/lib/monitoring/display";
import type {
  GoogleAdsAttributionMethod,
  GoogleAdsImpactConfidence,
  GoogleAdsImpactStatus,
} from "@/generated/prisma/enums";

export type GoogleAdsImpactView = {
  status: GoogleAdsImpactStatus;
  title: string;
  spendLabel: string | null;
  spendValue: string | null;
  clicksLabel: string | null;
  clicksValue: string | null;
  methodLabel: string;
  confidenceLabel: string;
  coverageLabel: string | null;
  dailyContext: string | null;
  freshness: string | null;
  dataThrough: string | null;
  provisionalLabel: string | null;
  unavailableReason: string | null;
  info: string;
};

function methodLabel(method: GoogleAdsAttributionMethod): string {
  switch (method) {
    case "SOURCE_HOURLY":
      return "Hourly ad-source data";
    case "SOURCE_HOURLY_PRORATED":
      return "Hourly ad-source data, prorated to the incident window";
    case "DESTINATION_REPORTED_DAILY":
      return "Daily landing-page reporting";
    case "MIXED":
      return "Partial hourly ad-source data";
    default:
      return "Unavailable";
  }
}

function confidenceLabel(value: GoogleAdsImpactConfidence): string {
  switch (value) {
    case "HIGH":
      return "High";
    case "MEDIUM":
      return "Medium";
    case "LOW":
      return "Low";
    default:
      return "Unavailable";
  }
}

export function presentGoogleAdsImpact(input: {
  status: GoogleAdsImpactStatus;
  attributionMethod: GoogleAdsAttributionMethod;
  confidence: GoogleAdsImpactConfidence;
  isProvisional: boolean;
  dataIncomplete: boolean;
  currencyCode: string;
  windowCostMicros: bigint | null;
  windowClicksMilli: bigint | null;
  windowClicksEstimated: boolean;
  destinationDailyCostMicros: bigint | null;
  destinationDailyFrom: string | null;
  destinationDailyTo: string | null;
  totalRelevantSources: number;
  attributedSources: number;
  lastRefreshedAt: Date | null;
  dataThrough: Date | null;
  diagnosticCode: string | null;
  now?: Date;
}): GoogleAdsImpactView {
  const info =
    "Google Ads reporting granularity varies by destination and campaign type. Estimates are labeled when exact incident-window attribution is not available.";
  const coverage =
    input.totalRelevantSources > 0
      ? `${input.attributedSources} / ${input.totalRelevantSources} sources`
      : null;
  const dailyContext =
    input.destinationDailyCostMicros != null && input.destinationDailyFrom
      ? `Destination spend on incident date${
          input.destinationDailyTo &&
          input.destinationDailyTo !== input.destinationDailyFrom
            ? "s"
            : ""
        }: ${formatCurrencyFromMicros(input.destinationDailyCostMicros, input.currencyCode)}`
      : null;
  const freshness = input.lastRefreshedAt
    ? `Last refreshed ${formatRelativeTime(input.lastRefreshedAt, input.now)}`
    : null;
  const dataThrough = input.dataThrough
    ? `Google Ads data through ${new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        hourCycle: "h23",
      }).format(input.dataThrough)} UTC`
    : null;
  const provisionalLabel = input.isProvisional
    ? "LIVE / PROVISIONAL — figures can still change."
    : null;

  if (input.status === "PENDING") {
    return {
      status: input.status,
      title: "Google Ads impact",
      spendLabel: null,
      spendValue: null,
      clicksLabel: null,
      clicksValue: null,
      methodLabel: methodLabel(input.attributionMethod),
      confidenceLabel: confidenceLabel(input.confidence),
      coverageLabel: coverage,
      dailyContext,
      freshness,
      dataThrough,
      provisionalLabel,
      unavailableReason: "Google Ads impact is still being calculated.",
      info,
    };
  }

  if (input.status === "ERROR" || input.status === "UNAVAILABLE") {
    const reconnect =
      input.diagnosticCode === "REAUTH_REQUIRED"
        ? "Google Ads impact unavailable — reconnect Google Ads."
        : input.diagnosticCode === "DISCONNECTED" || input.dataIncomplete
          ? "Impact data incomplete because Google Ads was disconnected."
          : input.attributionMethod === "DESTINATION_REPORTED_DAILY"
            ? "Exact incident-window spend is unavailable."
            : "Impact data unavailable";
    return {
      status: input.status,
      title: "Google Ads impact",
      spendLabel: null,
      spendValue: null,
      clicksLabel: null,
      clicksValue: null,
      methodLabel: methodLabel(input.attributionMethod),
      confidenceLabel: confidenceLabel(input.confidence),
      coverageLabel: coverage,
      dailyContext,
      freshness,
      dataThrough,
      provisionalLabel,
      unavailableReason: reconnect,
      info,
    };
  }

  const zero =
    input.windowCostMicros === 0n &&
    (input.windowClicksMilli === 0n || input.windowClicksMilli == null);
  if (zero && input.status === "AVAILABLE") {
    return {
      status: input.status,
      title: "Google Ads impact",
      spendLabel: null,
      spendValue: null,
      clicksLabel: null,
      clicksValue: null,
      methodLabel: methodLabel(input.attributionMethod),
      confidenceLabel: confidenceLabel(input.confidence),
      coverageLabel: coverage,
      dailyContext,
      freshness,
      dataThrough,
      provisionalLabel,
      unavailableReason:
        "No Google Ads spend reported during the attributable incident window.",
      info,
    };
  }

  const estimated =
    input.windowClicksEstimated ||
    input.attributionMethod === "SOURCE_HOURLY_PRORATED" ||
    input.attributionMethod === "MIXED" ||
    input.status === "PARTIAL";
  const spendValue =
    input.windowCostMicros == null
      ? null
      : formatCurrencyFromMicros(input.windowCostMicros, input.currencyCode);
  const clicksValue =
    input.windowClicksMilli == null
      ? null
      : estimated
        ? formatEstimatedClicks(input.windowClicksMilli)
        : formatReportedClicks(input.windowClicksMilli);

  return {
    status: input.status,
    title: "Google Ads impact",
    spendLabel:
      input.status === "PARTIAL"
        ? "Partial spend attribution"
        : estimated
          ? "Estimated spend at risk"
          : "Spend during monitored outage",
    spendValue:
      input.status === "PARTIAL" && spendValue
        ? `${spendValue} attributed`
        : spendValue,
    clicksLabel: estimated ? "Estimated affected clicks" : "Affected clicks",
    clicksValue,
    methodLabel: methodLabel(input.attributionMethod),
    confidenceLabel: confidenceLabel(input.confidence),
    coverageLabel: coverage,
    dailyContext,
    freshness,
    dataThrough,
    provisionalLabel,
    unavailableReason: null,
    info,
  };
}

export function compactImpactLine(view: GoogleAdsImpactView): string | null {
  if (!view.spendValue) return null;
  if (view.status !== "AVAILABLE" && view.status !== "PARTIAL") return null;
  const estimated =
    view.spendLabel?.toLowerCase().includes("estimated") ||
    view.status === "PARTIAL";
  return estimated
    ? `${view.spendValue} estimated at risk`
    : `${view.spendValue} at risk`;
}
