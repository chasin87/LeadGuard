const ASCII_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
export const MAX_REVENUE_MINOR_UNITS = 10n ** 15n;

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

export function canonicalizeCurrencyCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!CURRENCY_CODE.test(code)) return null;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code }).format(
      1,
    );
    return code;
  } catch {
    return null;
  }
}

export function getCurrencyFractionDigits(currencyCode: string): number {
  const code = canonicalizeCurrencyCode(currencyCode);
  if (!code) {
    throw new MoneyParseError("Unsupported currency.");
  }
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    throw new MoneyParseError("Unsupported currency.");
  }
}

export function parseMoney(
  amount: string,
  currency: string,
): { amountMinor: bigint; currencyCode: string; decimal: string } {
  const currencyCode = canonicalizeCurrencyCode(currency);
  if (!currencyCode) {
    throw new MoneyParseError("Unsupported currency.");
  }
  if (typeof amount !== "string") {
    throw new MoneyParseError("Amount must be a decimal string.");
  }
  if (/\s/.test(amount) || /[^\x20-\x7E]/.test(amount)) {
    throw new MoneyParseError("Amount must be a canonical decimal string.");
  }
  const trimmed = amount.trim();
  if (/[eE+]/.test(trimmed) || trimmed.includes(",") || trimmed.includes("-")) {
    throw new MoneyParseError("Amount must be a canonical decimal string.");
  }
  if (!ASCII_DECIMAL.test(trimmed)) {
    throw new MoneyParseError("Amount must be a canonical decimal string.");
  }

  const digits = getCurrencyFractionDigits(currencyCode);
  const [wholeRaw, fraction = ""] = trimmed.split(".");
  const whole = wholeRaw ?? "0";
  if (fraction.length > digits) {
    throw new MoneyParseError(
      `Amount has more fraction digits than ${currencyCode} allows.`,
    );
  }
  const paddedFraction = fraction.padEnd(digits, "0");
  const minorDigits = digits === 0 ? whole : `${whole}${paddedFraction}`;
  const amountMinor = BigInt(minorDigits);
  if (amountMinor < 0n) {
    throw new MoneyParseError("Negative revenue is not allowed.");
  }
  if (amountMinor > MAX_REVENUE_MINOR_UNITS) {
    throw new MoneyParseError("Amount exceeds the allowed maximum.");
  }
  return {
    amountMinor,
    currencyCode,
    decimal: minorUnitsToDecimal(amountMinor, currencyCode),
  };
}

export function minorUnitsToDecimal(
  amountMinor: bigint,
  currencyCode: string,
): string {
  if (amountMinor < 0n) {
    throw new MoneyParseError("Negative revenue is not allowed.");
  }
  const digits = getCurrencyFractionDigits(currencyCode);
  if (digits === 0) return amountMinor.toString();
  const scale = 10n ** BigInt(digits);
  const whole = amountMinor / scale;
  const fraction = (amountMinor % scale).toString().padStart(digits, "0");
  return `${whole.toString()}.${fraction}`;
}

export function formatMoney(
  amountMinor: bigint,
  currencyCode: string,
  locale = "en-GB",
): string {
  const digits = getCurrencyFractionDigits(currencyCode);
  const decimal = minorUnitsToDecimal(amountMinor, currencyCode);
  try {
    if (
      amountMinor <= BigInt(Number.MAX_SAFE_INTEGER) &&
      Number.isSafeInteger(Number(amountMinor.toString()))
    ) {
      const major = Number(decimal);
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(major);
    }
  } catch {
    return `${decimal} ${currencyCode}`;
  }
  return `${decimal} ${currencyCode}`;
}
