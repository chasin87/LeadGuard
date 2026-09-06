export const MANUAL_SUSPENSION_REASONS = [
  "Security review",
  "Abuse",
  "Customer request",
  "Billing investigation",
] as const;

export type ManualSuspensionReason = (typeof MANUAL_SUSPENSION_REASONS)[number];

export const PAGE_SIZE = 40;
export const MAX_SEARCH_LENGTH = 80;
export const MAX_REASON_LENGTH = 240;

export function isManualSuspensionReason(
  value: string,
): value is ManualSuspensionReason {
  return (MANUAL_SUSPENSION_REASONS as readonly string[]).includes(value);
}

export function boundSearch(value: string | undefined): string {
  return (value ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
}

export function boundReason(value: string | undefined): string {
  return (value ?? "").trim().slice(0, MAX_REASON_LENGTH);
}

export function accountStatus(input: {
  manualSuspendedAt: Date | null;
  billingEffective: string;
  overLimit: boolean;
}): "ACTIVE" | "SUSPENDED" | "TRIAL_EXPIRED" | "OVER_LIMIT" {
  if (input.manualSuspendedAt) return "SUSPENDED";
  if (input.billingEffective === "TRIAL_EXPIRED") return "TRIAL_EXPIRED";
  if (input.overLimit) return "OVER_LIMIT";
  return "ACTIVE";
}
