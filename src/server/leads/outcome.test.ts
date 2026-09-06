import { describe, expect, it } from "vitest";
import { calculateLeadOutcomeMutation } from "./outcome";

const occurred = new Date("2026-08-31T10:00:00.000Z");
const now = new Date("2026-08-31T13:00:00.000Z");

function current(
  overrides: Partial<
    Parameters<typeof calculateLeadOutcomeMutation>[0]["current"]
  > = {},
) {
  return {
    status: "NEW" as const,
    version: 1,
    statusChangedAt: occurred,
    qualifiedAt: null,
    wonAt: null,
    lostAt: null,
    revenueAmountMinor: null,
    revenueCurrencyCode: null,
    revenueSource: null,
    revenueUpdatedAt: null,
    ...overrides,
  };
}

describe("calculateLeadOutcomeMutation", () => {
  it("supports NEW to QUALIFIED, WON and LOST", () => {
    for (const status of ["QUALIFIED", "WON", "LOST"] as const) {
      const result = calculateLeadOutcomeMutation({
        current: current(),
        requestedStatus: status,
        requestedRevenue: { kind: "keep" },
        confirmTerminalTransition: false,
        effectiveAt: now,
        now,
        leadOccurredAt: occurred,
      });
      expect(result.ok && !result.noop && result.status).toBe(status);
    }
  });

  it("is a no-op for the same status and revenue", () => {
    const result = calculateLeadOutcomeMutation({
      current: current({ status: "WON", version: 4 }),
      requestedStatus: "WON",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: false,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(result).toEqual({ ok: true, noop: true });
  });

  it("requires confirmation for WON to LOST", () => {
    const rejected = calculateLeadOutcomeMutation({
      current: current({
        status: "WON",
        revenueAmountMinor: 450000n,
        revenueCurrencyCode: "EUR",
        revenueSource: "MANUAL",
      }),
      requestedStatus: "LOST",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: false,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.code).toBe("TERMINAL_CONFIRMATION_REQUIRED");

    const allowed = calculateLeadOutcomeMutation({
      current: current({
        status: "WON",
        version: 3,
        revenueAmountMinor: 450000n,
        revenueCurrencyCode: "EUR",
        revenueSource: "MANUAL",
      }),
      requestedStatus: "LOST",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: true,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(allowed.ok && !allowed.noop).toBe(true);
    if (!allowed.ok || allowed.noop) return;
    expect(allowed.status).toBe("LOST");
    expect(allowed.revenueAmountMinor).toBeNull();
    expect(allowed.changeType).toBe("STATUS_AND_REVENUE_CHANGED");
  });

  it("does not restore revenue after LOST then WON", () => {
    const result = calculateLeadOutcomeMutation({
      current: current({ status: "LOST", version: 5, lostAt: now }),
      requestedStatus: "WON",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: true,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(result.ok && !result.noop && result.revenueAmountMinor).toBeNull();
  });

  it("rejects revenue on non-WON statuses", () => {
    const result = calculateLeadOutcomeMutation({
      current: current({ status: "QUALIFIED" }),
      requestedStatus: "QUALIFIED",
      requestedRevenue: {
        kind: "set",
        amountMinor: 50000n,
        currencyCode: "EUR",
      },
      confirmTerminalTransition: false,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REVENUE_REQUIRES_WON");
  });

  it("allows WON without revenue and later revenue updates", () => {
    const won = calculateLeadOutcomeMutation({
      current: current(),
      requestedStatus: "WON",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: false,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(won.ok && !won.noop && won.revenueAmountMinor).toBeNull();
    const updated = calculateLeadOutcomeMutation({
      current: current({
        status: "WON",
        version: 2,
        wonAt: now,
        revenueAmountMinor: 450000n,
        revenueCurrencyCode: "EUR",
        revenueSource: "MANUAL",
      }),
      requestedStatus: "WON",
      requestedRevenue: {
        kind: "set",
        amountMinor: 475000n,
        currencyCode: "EUR",
      },
      confirmTerminalTransition: false,
      effectiveAt: now,
      now,
      leadOccurredAt: occurred,
    });
    expect(updated.ok && !updated.noop && updated.revenueAmountMinor).toBe(
      475000n,
    );
    expect(updated.ok && !updated.noop && updated.nextVersion).toBe(3);
  });

  it("rejects effective times before the lead or far in the future", () => {
    const before = calculateLeadOutcomeMutation({
      current: current(),
      requestedStatus: "WON",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: false,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      now,
      leadOccurredAt: occurred,
    });
    expect(before.ok).toBe(false);
    const future = calculateLeadOutcomeMutation({
      current: current(),
      requestedStatus: "WON",
      requestedRevenue: { kind: "keep" },
      confirmTerminalTransition: false,
      effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
      now,
      leadOccurredAt: occurred,
    });
    expect(future.ok).toBe(false);
  });
});
