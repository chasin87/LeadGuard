import { describe, expect, it } from "vitest";
import {
  getCurrencyFractionDigits,
  MAX_REVENUE_MINOR_UNITS,
  MoneyParseError,
  formatMoney,
  minorUnitsToDecimal,
  parseMoney,
} from "./money";

describe("money", () => {
  it("uses ISO fraction digits", () => {
    expect(getCurrencyFractionDigits("EUR")).toBe(2);
    expect(getCurrencyFractionDigits("USD")).toBe(2);
    expect(getCurrencyFractionDigits("JPY")).toBe(0);
    expect(getCurrencyFractionDigits("KWD")).toBe(3);
  });

  it("round-trips a EUR amount without float drift", () => {
    const parsed = parseMoney("4500.10", "EUR");
    expect(parsed.amountMinor).toBe(450010n);
    expect(minorUnitsToDecimal(parsed.amountMinor, "EUR")).toBe("4500.10");
    expect(parsed.decimal).toBe("4500.10");
  });

  it("treats zero as a real amount", () => {
    expect(parseMoney("0.00", "EUR").amountMinor).toBe(0n);
  });

  it("accepts a large precise amount", () => {
    const parsed = parseMoney("900719925474.09", "EUR");
    expect(minorUnitsToDecimal(parsed.amountMinor, "EUR")).toBe(
      "900719925474.09",
    );
  });

  it("rejects negatives, exponents, commas and extra JPY fractions", () => {
    expect(() => parseMoney("-500", "EUR")).toThrow(MoneyParseError);
    expect(() => parseMoney("1e3", "EUR")).toThrow(MoneyParseError);
    expect(() => parseMoney("NaN", "EUR")).toThrow(MoneyParseError);
    expect(() => parseMoney("Infinity", "EUR")).toThrow(MoneyParseError);
    expect(() => parseMoney("€4.500,50", "EUR")).toThrow(MoneyParseError);
    expect(() => parseMoney("4500.00", "EURO")).toThrow(MoneyParseError);
    expect(() => parseMoney("100.50", "JPY")).toThrow(MoneyParseError);
    expect(() => parseMoney(" 4500.00", "EUR")).toThrow(MoneyParseError);
    expect(() => parseMoney(`${MAX_REVENUE_MINOR_UNITS + 1n}`, "JPY")).toThrow(
      MoneyParseError,
    );
  });

  it("formats for display without exposing minor units", () => {
    expect(formatMoney(450000n, "EUR")).toContain("4,500.00");
    expect(formatMoney(450000n, "EUR")).not.toContain("450000");
  });
});
