import type {
  LeadOutcomeSource,
  LeadOutcomeStatus,
} from "@/generated/prisma/enums";

export const LEAD_OUTCOME_STATUSES = [
  "NEW",
  "QUALIFIED",
  "WON",
  "LOST",
] as const satisfies readonly LeadOutcomeStatus[];

export const EFFECTIVE_AT_SKEW_MS = 5 * 60 * 1000;

export type LeadOutcomeSnapshot = {
  status: LeadOutcomeStatus;
  version: number;
  statusChangedAt: Date;
  qualifiedAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
  revenueAmountMinor: bigint | null;
  revenueCurrencyCode: string | null;
  revenueSource: LeadOutcomeSource | null;
  revenueUpdatedAt: Date | null;
};

export type RequestedRevenue =
  | { kind: "keep" }
  | { kind: "clear" }
  | {
      kind: "set";
      amountMinor: bigint;
      currencyCode: string;
      source?: LeadOutcomeSource;
    };

export type LeadOutcomeMutationInput = {
  current: LeadOutcomeSnapshot;
  requestedStatus: LeadOutcomeStatus | undefined;
  requestedRevenue: RequestedRevenue;
  confirmTerminalTransition: boolean;
  effectiveAt: Date;
  now: Date;
  leadOccurredAt: Date;
};

export type LeadOutcomeMutationErrorCode =
  | "REVENUE_REQUIRES_WON"
  | "TERMINAL_CONFIRMATION_REQUIRED"
  | "EFFECTIVE_BEFORE_LEAD"
  | "EFFECTIVE_IN_FUTURE";

export type CalculatedLeadOutcome =
  | { ok: false; code: LeadOutcomeMutationErrorCode; message: string }
  | {
      ok: true;
      noop: true;
    }
  | {
      ok: true;
      noop: false;
      changeType:
        "STATUS_CHANGED" | "REVENUE_CHANGED" | "STATUS_AND_REVENUE_CHANGED";
      status: LeadOutcomeStatus;
      statusChangedAt: Date;
      qualifiedAt: Date | null;
      wonAt: Date | null;
      lostAt: Date | null;
      revenueAmountMinor: bigint | null;
      revenueCurrencyCode: string | null;
      revenueSource: LeadOutcomeSource | null;
      revenueUpdatedAt: Date | null;
      nextVersion: number;
    };

function sameRevenue(
  leftAmount: bigint | null,
  leftCurrency: string | null,
  rightAmount: bigint | null,
  rightCurrency: string | null,
): boolean {
  return leftAmount === rightAmount && leftCurrency === rightCurrency;
}

function timestampsForStatus(
  status: LeadOutcomeStatus,
  effectiveAt: Date,
  current: LeadOutcomeSnapshot,
): {
  qualifiedAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
} {
  if (status === "NEW") {
    return { qualifiedAt: null, wonAt: null, lostAt: null };
  }
  if (status === "QUALIFIED") {
    return { qualifiedAt: effectiveAt, wonAt: null, lostAt: null };
  }
  if (status === "WON") {
    return {
      qualifiedAt: current.qualifiedAt,
      wonAt: effectiveAt,
      lostAt: null,
    };
  }
  return {
    qualifiedAt: current.qualifiedAt,
    wonAt: null,
    lostAt: effectiveAt,
  };
}

export function calculateLeadOutcomeMutation(
  input: LeadOutcomeMutationInput,
): CalculatedLeadOutcome {
  const nextStatus = input.requestedStatus ?? input.current.status;
  const earliest = new Date(
    input.leadOccurredAt.getTime() - EFFECTIVE_AT_SKEW_MS,
  );
  if (input.effectiveAt.getTime() < earliest.getTime()) {
    return {
      ok: false,
      code: "EFFECTIVE_BEFORE_LEAD",
      message: "Outcome time cannot be before the lead was created.",
    };
  }
  if (
    input.effectiveAt.getTime() >
    input.now.getTime() + EFFECTIVE_AT_SKEW_MS
  ) {
    return {
      ok: false,
      code: "EFFECTIVE_IN_FUTURE",
      message: "Outcome time cannot be in the future.",
    };
  }

  const leavingWon = input.current.status === "WON" && nextStatus !== "WON";
  const terminalCorrection =
    (input.current.status === "WON" || input.current.status === "LOST") &&
    nextStatus !== input.current.status;
  if (terminalCorrection && !input.confirmTerminalTransition) {
    return {
      ok: false,
      code: "TERMINAL_CONFIRMATION_REQUIRED",
      message: "Confirm this correction before changing a Won or Lost lead.",
    };
  }

  let nextAmount = input.current.revenueAmountMinor;
  let nextCurrency = input.current.revenueCurrencyCode;
  let nextSource = input.current.revenueSource;
  let nextRevenueUpdatedAt: Date | null =
    input.current.revenueAmountMinor !== null ? input.effectiveAt : null;

  if (input.requestedRevenue.kind === "clear") {
    nextAmount = null;
    nextCurrency = null;
    nextSource = null;
    nextRevenueUpdatedAt = input.effectiveAt;
  } else if (input.requestedRevenue.kind === "set") {
    nextAmount = input.requestedRevenue.amountMinor;
    nextCurrency = input.requestedRevenue.currencyCode;
    nextSource = input.requestedRevenue.source ?? "MANUAL";
    nextRevenueUpdatedAt = input.effectiveAt;
  } else if (nextStatus !== "WON") {
    nextAmount = null;
    nextCurrency = null;
    nextSource = null;
    nextRevenueUpdatedAt = leavingWon ? input.effectiveAt : null;
  } else if (input.current.status !== "WON") {
    nextAmount = null;
    nextCurrency = null;
    nextSource = null;
    nextRevenueUpdatedAt = null;
  }

  if (nextStatus !== "WON" && (nextAmount !== null || nextCurrency !== null)) {
    return {
      ok: false,
      code: "REVENUE_REQUIRES_WON",
      message: "Realized revenue can only exist on a Won lead.",
    };
  }
  if (nextAmount !== null && nextCurrency === null) {
    return {
      ok: false,
      code: "REVENUE_REQUIRES_WON",
      message: "Revenue requires a currency.",
    };
  }

  const statusChanged = nextStatus !== input.current.status;
  const revenueChanged = !sameRevenue(
    input.current.revenueAmountMinor,
    input.current.revenueCurrencyCode,
    nextAmount,
    nextCurrency,
  );
  if (!statusChanged && !revenueChanged) {
    return { ok: true, noop: true };
  }

  const stamps = timestampsForStatus(
    nextStatus,
    input.effectiveAt,
    input.current,
  );
  return {
    ok: true,
    noop: false,
    changeType: statusChanged
      ? revenueChanged
        ? "STATUS_AND_REVENUE_CHANGED"
        : "STATUS_CHANGED"
      : "REVENUE_CHANGED",
    status: nextStatus,
    statusChangedAt: statusChanged
      ? input.effectiveAt
      : input.current.statusChangedAt,
    qualifiedAt: stamps.qualifiedAt,
    wonAt: stamps.wonAt,
    lostAt: stamps.lostAt,
    revenueAmountMinor: nextAmount,
    revenueCurrencyCode: nextCurrency,
    revenueSource: nextSource,
    revenueUpdatedAt: revenueChanged
      ? nextRevenueUpdatedAt
      : input.current.revenueUpdatedAt,
    nextVersion: input.current.version + 1,
  };
}
