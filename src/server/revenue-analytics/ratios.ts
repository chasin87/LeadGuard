import { formatMoney, getCurrencyFractionDigits } from "@/lib/money";
import { microsToMinorUnits } from "@/lib/google-ads/money";

export function spendMicrosToMinor(
  costMicros: bigint,
  currencyCode: string,
): bigint {
  return microsToMinorUnits(costMicros, currencyCode);
}

export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Denominator must be positive.");
  }
  if (numerator >= 0n) {
    return (numerator + denominator / 2n) / denominator;
  }
  return (numerator - denominator / 2n) / denominator;
}

export function ratioTimesHundredths(
  revenueMinor: bigint,
  spendMinor: bigint,
): bigint | null {
  if (spendMinor <= 0n) return null;
  return (revenueMinor * 100n) / spendMinor;
}

export function formatTimes(timesHundredths: bigint): string {
  const negative = timesHundredths < 0n;
  const absolute = negative ? -timesHundredths : timesHundredths;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}x`;
}

export function rateHundredths(
  numerator: number,
  denominator: number,
): bigint | null {
  if (denominator <= 0) return null;
  return (BigInt(numerator) * 10000n) / BigInt(denominator);
}

export function formatPercent(hundredths: bigint): string {
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}%`;
}

export function costPerCount(
  spendMinor: bigint,
  count: number,
  currencyCode: string,
): { amountMinor: bigint; formatted: string } | null {
  if (count <= 0) return null;
  const amountMinor = divideRounded(spendMinor, BigInt(count));
  return {
    amountMinor,
    formatted: formatMoney(amountMinor, currencyCode),
  };
}

export function currencyDigits(currencyCode: string): number {
  return getCurrencyFractionDigits(currencyCode);
}
