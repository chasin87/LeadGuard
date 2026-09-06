import type { LeadOutcomeStatus } from "@/generated/prisma/enums";

export type ExternalOutcomeFreshnessInput = {
  incomingEffectiveAt: Date;
  incomingSourceVersion: number | null;
  incomingSourceEventId: string;
  incomingStatus: LeadOutcomeStatus;
  incomingRevenueAmountMinor: bigint | null;
  incomingRevenueCurrencyCode: string | null;
  currentStatus: LeadOutcomeStatus;
  currentStatusChangedAt: Date;
  currentRevenueUpdatedAt: Date | null;
  currentRevenueAmountMinor: bigint | null;
  currentRevenueCurrencyCode: string | null;
  lastAppliedEffectiveAt: Date | null;
  lastAppliedSourceVersion: number | null;
};

export type ExternalOutcomeFreshnessResult =
  { decision: "APPLY" } | { decision: "STALE" } | { decision: "CONFLICT" };

function currentBusinessTime(input: ExternalOutcomeFreshnessInput): number {
  const statusTime = input.currentStatusChangedAt.getTime();
  const revenueTime = input.currentRevenueUpdatedAt?.getTime() ?? Number.NaN;
  return Number.isFinite(revenueTime)
    ? Math.max(statusTime, revenueTime)
    : statusTime;
}

function sameResult(input: ExternalOutcomeFreshnessInput): boolean {
  return (
    input.incomingStatus === input.currentStatus &&
    input.incomingRevenueAmountMinor === input.currentRevenueAmountMinor &&
    input.incomingRevenueCurrencyCode === input.currentRevenueCurrencyCode
  );
}

export function evaluateExternalOutcomeFreshness(
  input: ExternalOutcomeFreshnessInput,
): ExternalOutcomeFreshnessResult {
  const incoming = input.incomingEffectiveAt.getTime();
  const current = currentBusinessTime(input);
  const lastApplied = input.lastAppliedEffectiveAt?.getTime() ?? null;

  if (lastApplied !== null && incoming < lastApplied) {
    return { decision: "STALE" };
  }
  if (incoming < current) {
    return { decision: "STALE" };
  }

  if (
    incoming === current ||
    (lastApplied !== null && incoming === lastApplied)
  ) {
    if (sameResult(input)) {
      return { decision: "APPLY" };
    }
    const incomingVersion = input.incomingSourceVersion;
    const lastVersion = input.lastAppliedSourceVersion;
    if (
      incomingVersion !== null &&
      lastVersion !== null &&
      incomingVersion !== lastVersion
    ) {
      return incomingVersion > lastVersion
        ? { decision: "APPLY" }
        : { decision: "STALE" };
    }
    if (incomingVersion !== null && lastVersion === null) {
      return { decision: "APPLY" };
    }
    return { decision: "CONFLICT" };
  }

  return { decision: "APPLY" };
}
