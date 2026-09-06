export type TrackingMetricName =
  | "tracking_events_received"
  | "tracking_events_rejected"
  | "attribution_touches_created"
  | "leads_created"
  | "leads_attributed"
  | "leads_unattributed"
  | "tracking_rate_limited";

const counters: Record<TrackingMetricName, number> = {
  tracking_events_received: 0,
  tracking_events_rejected: 0,
  attribution_touches_created: 0,
  leads_created: 0,
  leads_attributed: 0,
  leads_unattributed: 0,
  tracking_rate_limited: 0,
};

export function incrementTrackingMetric(
  name: TrackingMetricName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function getTrackingMetrics(): Readonly<
  Record<TrackingMetricName, number>
> {
  return { ...counters };
}

export function resetTrackingMetricsForTests(): void {
  for (const key of Object.keys(counters) as TrackingMetricName[]) {
    counters[key] = 0;
  }
}
