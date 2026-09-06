export type GoogleAdsAnalyticsMetricName =
  | "google_ads_analytics_syncs_total"
  | "google_ads_analytics_rows_upserted"
  | "google_ads_click_resolution_total"
  | "google_ads_click_resolution_failed"
  | "google_ads_click_resolution_unresolved";

const counters: Record<GoogleAdsAnalyticsMetricName, number> = {
  google_ads_analytics_syncs_total: 0,
  google_ads_analytics_rows_upserted: 0,
  google_ads_click_resolution_total: 0,
  google_ads_click_resolution_failed: 0,
  google_ads_click_resolution_unresolved: 0,
};

export function incrementGoogleAdsAnalyticsMetric(
  name: GoogleAdsAnalyticsMetricName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function getGoogleAdsAnalyticsMetrics(): Readonly<
  Record<GoogleAdsAnalyticsMetricName, number>
> {
  return { ...counters };
}

export function resetGoogleAdsAnalyticsMetricsForTests(): void {
  for (const key of Object.keys(counters) as GoogleAdsAnalyticsMetricName[]) {
    counters[key] = 0;
  }
}
