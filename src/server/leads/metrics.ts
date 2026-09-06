export type LeadOutcomeMetricName =
  | "lead_outcome_changes_total"
  | "leads_won_total"
  | "leads_lost_total"
  | "lead_revenue_updates_total"
  | "lead_outcome_conflicts_total";

const counters: Record<LeadOutcomeMetricName, number> = {
  lead_outcome_changes_total: 0,
  leads_won_total: 0,
  leads_lost_total: 0,
  lead_revenue_updates_total: 0,
  lead_outcome_conflicts_total: 0,
};

export function incrementLeadOutcomeMetric(
  name: LeadOutcomeMetricName,
  amount = 1,
): void {
  counters[name] += amount;
}

export function getLeadOutcomeMetrics(): Readonly<
  Record<LeadOutcomeMetricName, number>
> {
  return { ...counters };
}

export function resetLeadOutcomeMetricsForTests(): void {
  for (const key of Object.keys(counters) as LeadOutcomeMetricName[]) {
    counters[key] = 0;
  }
}
