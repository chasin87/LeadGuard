import { describe, expect, it } from "vitest";
import { resolveLeadAttribution } from "@/server/tracking/resolver";

function touch(id: string, capturedAt: string, expiresAt: string, paid = true) {
  return {
    id,
    capturedAt: new Date(capturedAt),
    expiresAt: new Date(expiresAt),
    hasGclid: paid,
    hasGbraid: false,
    hasWbraid: false,
    channel: paid ? ("GOOGLE_ADS" as const) : ("DIRECT" as const),
  };
}

describe("lead attribution resolver", () => {
  it("uses the latest eligible paid touch as primary and keeps first touch", () => {
    const result = resolveLeadAttribution({
      leadOccurredAt: new Date("2026-08-10T12:00:00.000Z"),
      now: new Date("2026-08-10T12:00:00.000Z"),
      touches: [
        touch("A", "2026-08-01T00:00:00.000Z", "2026-10-30T00:00:00.000Z"),
        touch("B", "2026-08-05T00:00:00.000Z", "2026-11-03T00:00:00.000Z"),
      ],
    });
    expect(result.primaryTouchId).toBe("B");
    expect(result.firstTouchId).toBe("A");
    expect(result.attributionStatus).toBe("ATTRIBUTED");
  });

  it("attributes a later direct visit to the earlier paid touch", () => {
    const result = resolveLeadAttribution({
      leadOccurredAt: new Date("2026-08-03T00:00:00.000Z"),
      now: new Date("2026-08-03T00:00:00.000Z"),
      touches: [
        touch("A", "2026-08-01T00:00:00.000Z", "2026-10-30T00:00:00.000Z"),
      ],
    });
    expect(result.primaryTouchId).toBe("A");
  });

  it("does not use an expired touch", () => {
    const result = resolveLeadAttribution({
      leadOccurredAt: new Date("2026-12-01T00:00:00.000Z"),
      now: new Date("2026-12-01T00:00:00.000Z"),
      touches: [
        touch("A", "2026-08-01T00:00:00.000Z", "2026-10-30T00:00:00.000Z"),
      ],
    });
    expect(result.primaryTouchId).toBeNull();
    expect(result.attributionStatus).toBe("EXPIRED");
  });

  it("does not attribute a touch captured after the lead", () => {
    const result = resolveLeadAttribution({
      leadOccurredAt: new Date("2026-08-01T12:00:00.000Z"),
      now: new Date("2026-08-01T12:00:00.000Z"),
      touches: [
        touch("A", "2026-08-01T13:00:00.000Z", "2026-11-01T00:00:00.000Z"),
      ],
    });
    expect(result.primaryTouchId).toBeNull();
    expect(result.attributionStatus).toBe("UNATTRIBUTED");
  });
});
