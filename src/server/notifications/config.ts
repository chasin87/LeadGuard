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

export function getNotificationConfig() {
  return {
    maxChannelsPerOrganization: 10,
    webhookTimeoutMs: 10_000,
    webhookMaxResponseBytes: 1024,
    maxDeliveryAttempts: 5,
    dispatcherBatchSize: 25,
    dispatcherPollMs: 2_000,
    workerConcurrency: intEnv("NOTIFICATION_WORKER_CONCURRENCY", 5, 1, 50),
    staleSendingMs: 120_000,
    testCooldownMs: 30_000,
    retryBackoffSeconds: [60, 300, 1800, 7200] as const,
    webhookUserAgent: "LeadGuard-Webhook/1.0",
  };
}

export const notificationDeliveryQueue = "notification.delivery";
