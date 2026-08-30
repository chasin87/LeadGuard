const digitsOnly = /^\d+$/;

export function normalizeGoogleCustomerId(value: string): string {
  return value.replace(/[-\s]/g, "").trim();
}

export function isGoogleCustomerId(value: string): boolean {
  const normalized = normalizeGoogleCustomerId(value);
  return (
    digitsOnly.test(normalized) &&
    normalized.length >= 6 &&
    normalized.length <= 16
  );
}

export function googleCustomerResourceName(customerId: string): string {
  return `customers/${normalizeGoogleCustomerId(customerId)}`;
}

export function parseCustomerIdFromResourceName(
  resourceName: string,
): string | null {
  const match = resourceName.trim().match(/customers\/(\d+)/);
  return match?.[1] ?? null;
}

export function asGoogleIdString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  return value == null ? "" : String(value);
}
