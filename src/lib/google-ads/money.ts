export const MICROS_PER_UNIT = 1_000_000n;

export function parseMicros(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return 0n;
}

export function prorateMicros(
  costMicros: bigint,
  overlapMs: bigint,
  bucketMs: bigint,
): bigint {
  if (bucketMs <= 0n || overlapMs <= 0n || costMicros === 0n) return 0n;
  if (overlapMs >= bucketMs) return costMicros;
  return (costMicros * overlapMs) / bucketMs;
}

export function clicksToMilli(clicks: bigint): bigint {
  return clicks * 1000n;
}

export function prorateClicksMilli(
  clicks: bigint,
  overlapMs: bigint,
  bucketMs: bigint,
): bigint {
  if (bucketMs <= 0n || overlapMs <= 0n || clicks === 0n) return 0n;
  if (overlapMs >= bucketMs) return clicksToMilli(clicks);
  return (clicks * 1000n * overlapMs) / bucketMs;
}

export function currencyFractionDigits(currencyCode: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currencyCode,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function microsToMinorUnits(
  costMicros: bigint,
  currencyCode: string,
): bigint {
  const digits = currencyFractionDigits(currencyCode);
  const divisor = MICROS_PER_UNIT / 10n ** BigInt(digits);
  if (divisor <= 0n) return costMicros;
  const half = divisor / 2n;
  if (costMicros >= 0n) return (costMicros + half) / divisor;
  return (costMicros - half) / divisor;
}

export function formatCurrencyFromMicros(
  costMicros: bigint,
  currencyCode: string,
  locale = "en-GB",
): string {
  const digits = currencyFractionDigits(currencyCode);
  const minor = microsToMinorUnits(costMicros, currencyCode);
  const amount = Number(minor) / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currencyCode}`;
  }
}

export function formatEstimatedClicks(clicksMilli: bigint): string {
  if (clicksMilli % 1000n === 0n) {
    return clicksMilli / 1000n === 1n ? "1" : `${clicksMilli / 1000n}`;
  }
  const whole = clicksMilli / 1000n;
  const tenths = (clicksMilli % 1000n) / 100n;
  if (tenths === 0n) return `~${whole}`;
  return `~${whole}.${tenths}`;
}

export function formatReportedClicks(clicksMilli: bigint): string {
  const rounded =
    clicksMilli >= 0n
      ? (clicksMilli + 500n) / 1000n
      : (clicksMilli - 500n) / 1000n;
  return rounded.toString();
}
