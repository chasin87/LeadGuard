import { getCurrencyFractionDigits, minorUnitsToDecimal } from "@/lib/money";

export class DataManagerValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataManagerValueError";
  }
}

/**
 * Data Manager `conversionValue` is a JSON number. LeadGuard never stores
 * revenue as a float; this conversion happens only at the provider boundary.
 */
export function toDataManagerConversionValue(
  amountMinor: bigint,
  currencyCode: string,
): { conversionValue: number; currency: string; decimal: string } {
  const decimal = minorUnitsToDecimal(amountMinor, currencyCode);
  const conversionValue = Number(decimal);
  if (!Number.isFinite(conversionValue)) {
    throw new DataManagerValueError("Conversion value is not finite.");
  }
  const digits = getCurrencyFractionDigits(currencyCode);
  const roundTripped = conversionValue.toFixed(digits);
  const expected =
    digits === 0
      ? decimal
      : decimal.includes(".")
        ? decimal
        : `${decimal}.${"0".repeat(digits)}`;
  if (roundTripped !== expected && Number(roundTripped) !== Number(expected)) {
    throw new DataManagerValueError(
      "Conversion value cannot be serialized without precision loss.",
    );
  }
  return { conversionValue, currency: currencyCode, decimal };
}
