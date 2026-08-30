export type BrowserMetricName =
  | "browser_checks_total"
  | "browser_check_failures"
  | "browser_check_duration_ms_sum"
  | "browser_process_restarts"
  | "browser_screenshots_captured";

const counters: Record<BrowserMetricName, number> = {
  browser_checks_total: 0,
  browser_check_failures: 0,
  browser_check_duration_ms_sum: 0,
  browser_process_restarts: 0,
  browser_screenshots_captured: 0,
};

export function incrementBrowserMetric(
  name: BrowserMetricName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function getBrowserMetrics(): Readonly<
  Record<BrowserMetricName, number>
> {
  return { ...counters };
}

export function resetBrowserMetricsForTests(): void {
  for (const key of Object.keys(counters) as BrowserMetricName[]) {
    counters[key] = 0;
  }
}
