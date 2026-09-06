export type OutcomeIngestionMetricName =
  | "outcome_ingestion_events_total"
  | "outcome_ingestion_applied_total"
  | "outcome_ingestion_unmatched_total"
  | "outcome_ingestion_stale_total"
  | "outcome_ingestion_conflicts_total"
  | "outcome_import_rows_total";

const counters: Record<OutcomeIngestionMetricName, number> = {
  outcome_ingestion_events_total: 0,
  outcome_ingestion_applied_total: 0,
  outcome_ingestion_unmatched_total: 0,
  outcome_ingestion_stale_total: 0,
  outcome_ingestion_conflicts_total: 0,
  outcome_import_rows_total: 0,
};

export function incrementOutcomeIngestionMetric(
  name: OutcomeIngestionMetricName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function getOutcomeIngestionMetrics(): Readonly<
  Record<OutcomeIngestionMetricName, number>
> {
  return { ...counters };
}

export function resetOutcomeIngestionMetricsForTests(): void {
  for (const key of Object.keys(counters) as OutcomeIngestionMetricName[]) {
    counters[key] = 0;
  }
}
