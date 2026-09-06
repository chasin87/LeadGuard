import { describe, expect, it } from "vitest";
import { heartbeatHealth } from "./health";

describe("worker heartbeat health", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");

  it("marks recent heartbeats healthy", () => {
    expect(heartbeatHealth(new Date("2026-09-05T11:59:00.000Z"), now)).toBe(
      "HEALTHY",
    );
  });

  it("marks aging heartbeats degraded then stale", () => {
    expect(heartbeatHealth(new Date("2026-09-05T11:57:00.000Z"), now)).toBe(
      "DEGRADED",
    );
    expect(heartbeatHealth(new Date("2026-09-05T11:50:00.000Z"), now)).toBe(
      "STALE",
    );
    expect(heartbeatHealth(null, now)).toBe("MISSING");
  });
});
