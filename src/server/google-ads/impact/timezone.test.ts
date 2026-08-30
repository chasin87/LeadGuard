import { describe, expect, it } from "vitest";
import {
  enumerateZonedDates,
  isValidTimeZone,
  overlapMs,
  zonedDateHour,
  zonedHourUtcRange,
  zonedLocalToUtc,
} from "@/server/google-ads/impact/timezone";

describe("Google Ads customer timezone", () => {
  it("converts Amsterdam summer time without using the server zone", () => {
    const start = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 15);
    expect(start.toISOString()).toBe("2026-08-30T12:15:00.000Z");
    const parts = zonedDateHour(start, "Europe/Amsterdam");
    expect(parts).toEqual({ date: "2026-08-30", hour: 14 });
  });

  it("handles the spring-forward DST gap", () => {
    const before = zonedLocalToUtc("Europe/Amsterdam", 2026, 3, 29, 1, 30);
    const after = zonedLocalToUtc("Europe/Amsterdam", 2026, 3, 29, 3, 30);
    expect(after.getTime() - before.getTime()).toBe(60 * 60 * 1000);
    const hour2 = zonedHourUtcRange("Europe/Amsterdam", "2026-03-29", 2);
    expect(hour2.end.getTime() - hour2.start.getTime()).toBe(0);
  });

  it("handles the fall-back repeated hour", () => {
    const hour2 = zonedHourUtcRange("Europe/Amsterdam", "2026-10-25", 2);
    expect(hour2.end.getTime() - hour2.start.getTime()).toBe(
      2 * 60 * 60 * 1000,
    );
  });

  it("enumerates dates across midnight", () => {
    const start = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 22, 20);
    const end = zonedLocalToUtc("Europe/Amsterdam", 2026, 9, 1, 8, 10);
    expect(enumerateZonedDates(start, end, "Europe/Amsterdam")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });

  it("rejects invalid timezones", () => {
    expect(isValidTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("computes hour overlap", () => {
    const bucket = zonedHourUtcRange("Europe/Amsterdam", "2026-08-30", 14);
    const windowStart = zonedLocalToUtc(
      "Europe/Amsterdam",
      2026,
      8,
      30,
      14,
      15,
    );
    const windowEnd = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 15, 0);
    expect(overlapMs(bucket.start, bucket.end, windowStart, windowEnd)).toBe(
      45 * 60 * 1000,
    );
  });
});
