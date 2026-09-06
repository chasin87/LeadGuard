import { describe, expect, it } from "vitest";
import { evaluateExternalOutcomeFreshness } from "./freshness";

const base = {
  incomingSourceEventId: "evt-2",
  incomingStatus: "QUALIFIED" as const,
  incomingRevenueAmountMinor: null,
  incomingRevenueCurrencyCode: null,
  incomingSourceVersion: null as number | null,
  currentStatus: "WON" as const,
  currentStatusChangedAt: new Date("2026-08-31T15:00:00.000Z"),
  currentRevenueUpdatedAt: new Date("2026-08-31T15:00:00.000Z"),
  currentRevenueAmountMinor: 450000n,
  currentRevenueCurrencyCode: "EUR",
  lastAppliedEffectiveAt: new Date("2026-08-31T15:00:00.000Z"),
  lastAppliedSourceVersion: null as number | null,
};

describe("evaluateExternalOutcomeFreshness", () => {
  it("marks an older QUALIFIED event as STALE after WON", () => {
    const result = evaluateExternalOutcomeFreshness({
      ...base,
      incomingEffectiveAt: new Date("2026-08-31T14:00:00.000Z"),
    });
    expect(result).toEqual({ decision: "STALE" });
  });

  it("applies a newer external WON after an older manual QUALIFIED", () => {
    const result = evaluateExternalOutcomeFreshness({
      ...base,
      incomingStatus: "WON",
      incomingEffectiveAt: new Date("2026-08-31T16:00:00.000Z"),
      currentStatus: "QUALIFIED",
      currentStatusChangedAt: new Date("2026-08-31T15:00:00.000Z"),
      currentRevenueUpdatedAt: null,
      currentRevenueAmountMinor: null,
      currentRevenueCurrencyCode: null,
      lastAppliedEffectiveAt: null,
    });
    expect(result).toEqual({ decision: "APPLY" });
  });

  it("does not let arrival time resurrect a stale event", () => {
    const result = evaluateExternalOutcomeFreshness({
      ...base,
      incomingEffectiveAt: new Date("2026-08-31T14:30:00.000Z"),
    });
    expect(result.decision).toBe("STALE");
  });

  it("conflicts when two different states share the same effectiveAt", () => {
    const result = evaluateExternalOutcomeFreshness({
      ...base,
      incomingEffectiveAt: new Date("2026-08-31T15:00:00.000Z"),
    });
    expect(result).toEqual({ decision: "CONFLICT" });
  });

  it("lets a higher sourceVersion win at the same effectiveAt", () => {
    const result = evaluateExternalOutcomeFreshness({
      ...base,
      incomingEffectiveAt: new Date("2026-08-31T15:00:00.000Z"),
      incomingSourceVersion: 4,
      lastAppliedSourceVersion: 2,
    });
    expect(result).toEqual({ decision: "APPLY" });
  });

  it("marks a lower sourceVersion as STALE", () => {
    const result = evaluateExternalOutcomeFreshness({
      ...base,
      incomingEffectiveAt: new Date("2026-08-31T15:00:00.000Z"),
      incomingSourceVersion: 1,
      lastAppliedSourceVersion: 2,
    });
    expect(result).toEqual({ decision: "STALE" });
  });
});
