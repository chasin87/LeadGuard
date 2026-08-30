import { getNotificationConfig } from "@/server/notifications/config";

export function nextRetryAt(
  failedAttemptCount: number,
  now = new Date(),
): Date | null {
  const config = getNotificationConfig();
  if (failedAttemptCount >= config.maxDeliveryAttempts) return null;
  const delays = config.retryBackoffSeconds;
  const seconds = delays[Math.min(failedAttemptCount - 1, delays.length - 1)];
  if (seconds === undefined) return null;
  const jitter =
    process.env.NODE_ENV === "test"
      ? 0
      : Math.floor(Math.random() * seconds * 0.2 * 1000);
  return new Date(now.getTime() + seconds * 1000 + jitter);
}
