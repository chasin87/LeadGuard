import { describe, expect, it } from "vitest";
import { formatDuration, incidentDurationMs } from "@/lib/incidents/duration";

describe("incident duration", () => {
  it("uses resolvedAt for closed incidents and now for open ones", () => {
    const started = new Date("2026-08-30T14:05:00.000Z");
    const resolved = new Date("2026-08-30T14:32:00.000Z");
    expect(incidentDurationMs(started, resolved)).toBe(27 * 60 * 1000);
    expect(
      incidentDurationMs(started, null, new Date("2026-08-30T14:15:00.000Z")),
    ).toBe(10 * 60 * 1000);
  });

  it("formats compact durations", () => {
    expect(formatDuration(1000)).toBe("1 sec");
    expect(formatDuration(42_000)).toBe("42 sec");
    expect(formatDuration(8 * 60_000)).toBe("8 min");
    expect(formatDuration((2 * 3600 + 14 * 60) * 1000)).toBe("2 h 14 min");
    expect(formatDuration((27 * 3600 + 0) * 1000)).toBe("1 d 3 h");
  });
});
