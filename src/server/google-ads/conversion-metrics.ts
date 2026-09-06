export type GoogleConversionMetricName =
  | "google_conversion_exports_created"
  | "google_conversion_exports_submitted"
  | "google_conversion_exports_succeeded"
  | "google_conversion_exports_rejected"
  | "google_conversion_exports_retryable"
  | "google_conversion_exports_out_of_sync"
  | "google_data_manager_requests"
  | "google_data_manager_errors";

const counters: Record<GoogleConversionMetricName, number> = {
  google_conversion_exports_created: 0,
  google_conversion_exports_submitted: 0,
  google_conversion_exports_succeeded: 0,
  google_conversion_exports_rejected: 0,
  google_conversion_exports_retryable: 0,
  google_conversion_exports_out_of_sync: 0,
  google_data_manager_requests: 0,
  google_data_manager_errors: 0,
};

export function incrementGoogleConversionMetric(
  name: GoogleConversionMetricName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function getGoogleConversionMetrics(): Readonly<
  Record<GoogleConversionMetricName, number>
> {
  return { ...counters };
}

export function resetGoogleConversionMetricsForTests(): void {
  for (const key of Object.keys(counters) as GoogleConversionMetricName[]) {
    counters[key] = 0;
  }
}
