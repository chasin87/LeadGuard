function intEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

export const receiptTimeoutQueue = "receipt.verification.timeout";
export const inboundEmailProviders = ["generic", "dev"] as const;
export type InboundEmailProviderName = (typeof inboundEmailProviders)[number];

export function getReceiptConfig() {
  const providerRaw = (process.env.INBOUND_EMAIL_PROVIDER ?? "").trim();
  const provider = inboundEmailProviders.includes(
    providerRaw as InboundEmailProviderName,
  )
    ? (providerRaw as InboundEmailProviderName)
    : "";
  const domain = (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase();
  const webhookSecret = (process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? "").trim();
  const defaultTimeoutMinutes = intEnv(
    "RECEIPT_DEFAULT_TIMEOUT_MINUTES",
    15,
    1,
    120,
  );
  const maxTimeoutMinutes = intEnv("RECEIPT_MAX_TIMEOUT_MINUTES", 120, 1, 120);
  const inboundReady =
    Boolean(domain) &&
    webhookSecret.length >= 32 &&
    (provider === "generic" || provider === "dev");
  const inboundSelectable =
    inboundReady &&
    (process.env.NODE_ENV !== "production" || provider === "generic");
  return {
    provider,
    domain,
    webhookSecret,
    defaultTimeoutMinutes,
    minTimeoutMinutes: 1,
    maxTimeoutMinutes,
    inboundReady,
    inboundSelectable,
    inboundAvailableInProduction: provider === "generic" && inboundReady,
    maxInboundBodyBytes: 256 * 1024,
    hmacWindowMs: 5 * 60 * 1000,
    webhookRateLimit: 30,
    webhookRateWindowMs: 60_000,
  };
}

export function inboundReceiptAddress(submissionId: string): string | null {
  const { domain, inboundReady } = getReceiptConfig();
  if (!inboundReady || !domain) return null;
  return `receipt+${submissionId}@${domain}`;
}

export function inboundReceiptAddressTemplate(): string | null {
  const { domain, inboundSelectable } = getReceiptConfig();
  if (!inboundSelectable || !domain) return null;
  return `receipt+{{submissionId}}@${domain}`;
}
