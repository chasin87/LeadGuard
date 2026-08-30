import { describe, expect, it } from "vitest";
import {
  deriveMonitorHealth,
  deriveWebsiteHealth,
} from "@/server/incidents/health";

describe("deriveMonitorHealth", () => {
  it("prefers an open incident over the latest check", () => {
    expect(
      deriveMonitorHealth({
        latestCheck: { status: "FAILURE" },
        hasOpenIncident: true,
      }),
    ).toBe("down");
    expect(
      deriveMonitorHealth({
        latestCheck: { status: "SUCCESS" },
        hasOpenIncident: false,
      }),
    ).toBe("operational");
    expect(
      deriveMonitorHealth({
        latestCheck: { status: "FAILURE" },
        hasOpenIncident: false,
      }),
    ).toBe("failing");
    expect(
      deriveMonitorHealth({ latestCheck: null, hasOpenIncident: false }),
    ).toBe("pending");
    expect(
      deriveMonitorHealth({
        latestCheck: { status: "SUCCESS" },
        hasOpenIncident: false,
        receiptStatus: "PENDING",
      }),
    ).toBe("pending_confirmation");
  });
});

describe("deriveWebsiteHealth", () => {
  it("uses the most severe monitor health", () => {
    expect(deriveWebsiteHealth([])).toBe("pending");
    expect(deriveWebsiteHealth(["operational", "pending"])).toBe("operational");
    expect(deriveWebsiteHealth(["operational", "degraded"])).toBe("degraded");
    expect(deriveWebsiteHealth(["operational", "failing"])).toBe("failing");
    expect(deriveWebsiteHealth(["failing", "down"])).toBe("down");
  });
});
