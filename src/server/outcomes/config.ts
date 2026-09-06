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

export function getOutcomeIngestionConfig() {
  return {
    maxBodyBytes: 256 * 1024,
    maxBatchEvents: 100,
    hmacWindowMs: 5 * 60 * 1000,
    credentialRotationGraceMinutes: 60,
    credentialRateLimit: intEnv("OUTCOME_API_RATE_LIMIT", 300, 30, 2000),
    organizationRateLimit: intEnv("OUTCOME_ORG_RATE_LIMIT", 600, 60, 5000),
    ipRateLimit: intEnv("OUTCOME_IP_RATE_LIMIT", 120, 20, 1000),
    rateWindowMs: 60_000,
    maxConcurrencyRetries: 3,
    importMaxFileBytes: 10 * 1024 * 1024,
    importMaxRows: 50_000,
    importBatchSize: 200,
    importFileRetentionDays: 30,
    previewRows: 20,
  };
}
