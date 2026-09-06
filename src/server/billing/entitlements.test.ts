import { describe, expect, it } from "vitest";
import {
  calculateEntitlements,
  applyEntitlementOverrides,
} from "./entitlements";

const usage = {
  websites: 1,
  monitors: 1,
  formMonitors: 0,
  members: 1,
  googleAdsCustomers: 0,
  outcomeIntegrations: 0,
};

describe("calculateEntitlements", () => {
  it("grants Growth limits during trial", () => {
    const result = calculateEntitlements({
      planKey: "GROWTH",
      status: "TRIALING",
      trialEnd: new Date("2026-09-20T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-20T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
    });
    expect(result.features.revenueAnalytics).toBe(true);
    expect(result.limits.maxWebsites).toBe(5);
    expect(result.canCreateBillableResources).toBe(true);
    expect(result.monitoringEnabled).toBe(true);
  });

  it("expires trial without granting paid access", () => {
    const result = calculateEntitlements({
      planKey: "GROWTH",
      status: "TRIALING",
      trialEnd: new Date("2026-09-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
    });
    expect(result.effectiveStatus).toBe("TRIAL_EXPIRED");
    expect(result.canCreateBillableResources).toBe(false);
    expect(result.monitoringEnabled).toBe(false);
    expect(result.limits.maxWebsites).toBe(0);
  });

  it("keeps monitoring during past-due grace", () => {
    const result = calculateEntitlements({
      planKey: "PRO",
      status: "PAST_DUE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: new Date("2026-09-12T00:00:00.000Z"),
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
    });
    expect(result.effectiveStatus).toBe("GRACE_PERIOD");
    expect(result.monitoringEnabled).toBe(true);
    expect(result.canCreateBillableResources).toBe(true);
  });

  it("suspends after grace deadline without deleting limits display", () => {
    const result = calculateEntitlements({
      planKey: "PRO",
      status: "PAST_DUE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: new Date("2026-09-08T00:00:00.000Z"),
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
    });
    expect(result.effectiveStatus).toBe("SUSPENDED");
    expect(result.monitoringEnabled).toBe(false);
    expect(result.canCreateBillableResources).toBe(false);
  });

  it("marks over-limit without revoking existing access", () => {
    const result = calculateEntitlements({
      planKey: "STARTER",
      status: "ACTIVE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage: { ...usage, websites: 10 },
    });
    expect(result.overLimit).toBe(true);
    expect(result.effectiveStatus).toBe("OVER_LIMIT");
    expect(result.monitoringEnabled).toBe(true);
    expect(result.canCreateBillableResources).toBe(false);
  });

  it("keeps access until cancel-at-period-end", () => {
    const result = calculateEntitlements({
      planKey: "GROWTH",
      status: "ACTIVE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-09-20T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
    });
    expect(result.effectiveStatus).toBe("ACTIVE");
    expect(result.canCreateBillableResources).toBe(true);
  });

  it("disables monitoring during manual suspension without changing billing status", () => {
    const result = calculateEntitlements({
      planKey: "PRO",
      status: "ACTIVE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
      manualSuspended: true,
    });
    expect(result.status).toBe("ACTIVE");
    expect(result.manualSuspended).toBe(true);
    expect(result.monitoringEnabled).toBe(false);
    expect(result.canCreateBillableResources).toBe(false);
  });
});

describe("applyEntitlementOverrides", () => {
  it("raises a limit without rewriting the plan key", () => {
    const base = calculateEntitlements({
      planKey: "STARTER",
      status: "ACTIVE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage: { ...usage, websites: 6 },
    });
    expect(base.overLimit).toBe(true);
    const next = applyEntitlementOverrides(
      base,
      [
        {
          featureKey: null,
          limitKey: "maxWebsites",
          booleanValue: null,
          integerValue: 10,
          expiresAt: null,
        },
      ],
      { ...usage, websites: 6 },
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(next.planKey).toBe("STARTER");
    expect(next.limits.maxWebsites).toBe(10);
    expect(next.overLimit).toBe(false);
    expect(next.canCreateBillableResources).toBe(true);
  });

  it("ignores expired overrides", () => {
    const base = calculateEntitlements({
      planKey: "STARTER",
      status: "ACTIVE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date("2026-09-10T00:00:00.000Z"),
      usage,
    });
    const next = applyEntitlementOverrides(
      base,
      [
        {
          featureKey: null,
          limitKey: "maxWebsites",
          booleanValue: null,
          integerValue: 10,
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ],
      usage,
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(next.limits.maxWebsites).toBe(1);
  });
});
