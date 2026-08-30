import { describe, expect, it } from "vitest";
import {
  formatCurrencyFromMicros,
  formatEstimatedClicks,
  formatReportedClicks,
  parseMicros,
  prorateClicksMilli,
  prorateMicros,
} from "@/lib/google-ads/money";

describe("Google Ads money", () => {
  it("converts micros to currency without float drift", () => {
    expect(formatCurrencyFromMicros(82_370_000n, "EUR")).toBe("€82.37");
    expect(formatCurrencyFromMicros(82_370_000n, "USD")).toBe("US$82.37");
  });

  it("does not add EUR and USD", () => {
    const eur = formatCurrencyFromMicros(50_000_000n, "EUR");
    const usd = formatCurrencyFromMicros(40_000_000n, "USD");
    expect(eur).toContain("50.00");
    expect(usd).toContain("40.00");
    expect(eur).not.toBe(usd);
  });

  it("parses int64 strings as bigint", () => {
    expect(parseMicros("82370000")).toBe(82_370_000n);
    expect(parseMicros(82_370_000)).toBe(82_370_000n);
  });

  it("prorates cost with integer arithmetic", () => {
    expect(prorateMicros(60_000_000n, 45n * 60_000n, 60n * 60_000n)).toBe(
      45_000_000n,
    );
  });

  it("prorates clicks to milli-clicks", () => {
    expect(prorateClicksMilli(10n, 45n * 60_000n, 60n * 60_000n)).toBe(7_500n);
    expect(formatEstimatedClicks(7_500n)).toBe("~7.5");
    expect(formatReportedClicks(23_000n)).toBe("23");
  });
});
