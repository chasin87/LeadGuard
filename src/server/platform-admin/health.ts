import type { WorkerHeartbeatType } from "@/generated/prisma/enums";
import { getBillingProviderKind } from "@/server/billing/config";
import { database } from "@/server/database";
import { getQueueBacklogSnapshot } from "@/server/ops/queue-health";
import { listQueueSummaries } from "@/server/platform-admin/jobs";

const HEALTHY_MS = 2 * 60 * 1000;
const DEGRADED_MS = 5 * 60 * 1000;

export type HeartbeatHealth = "HEALTHY" | "DEGRADED" | "STALE" | "MISSING";

export function heartbeatHealth(
  lastSeenAt: Date | null,
  now = new Date(),
): HeartbeatHealth {
  if (!lastSeenAt) return "MISSING";
  const age = now.getTime() - lastSeenAt.getTime();
  if (age <= HEALTHY_MS) return "HEALTHY";
  if (age <= DEGRADED_MS) return "DEGRADED";
  return "STALE";
}

const expectedWorkers: WorkerHeartbeatType[] = [
  "SCHEDULER",
  "HTTP",
  "BROWSER",
  "NOTIFICATION",
  "GOOGLE_ADS",
];

export async function getOperationsHealth() {
  const [heartbeats, queue, summaries, lastWebhook, lastNotification] =
    await Promise.all([
      database.workerHeartbeat.findMany({
        orderBy: { lastSeenAt: "desc" },
      }),
      getQueueBacklogSnapshot(),
      listQueueSummaries(),
      database.billingProviderEvent.findFirst({
        orderBy: { receivedAt: "desc" },
        select: {
          type: true,
          status: true,
          receivedAt: true,
          errorCode: true,
        },
      }),
      database.notificationDelivery.findFirst({
        where: { channel: { type: "EMAIL" } },
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true, sentAt: true },
      }),
    ]);
  const now = new Date();
  const workers = expectedWorkers.map((type) => {
    const row = heartbeats.find((item) => item.workerType === type);
    return {
      workerType: type,
      instanceId: row?.instanceId ?? null,
      lastSeenAt: row?.lastSeenAt ?? null,
      version: row?.version ?? null,
      status: heartbeatHealth(row?.lastSeenAt ?? null, now),
    };
  });
  const scheduler = workers.find((row) => row.workerType === "SCHEDULER");
  return {
    workers,
    scheduler: {
      lastTick: scheduler?.lastSeenAt ?? null,
      status: scheduler?.status ?? "MISSING",
    },
    queue,
    summaries,
    stripe: {
      configured: getBillingProviderKind() === "stripe",
      provider: getBillingProviderKind(),
      lastWebhookType: lastWebhook?.type ?? null,
      lastWebhookStatus: lastWebhook?.status ?? null,
      lastWebhookAt: lastWebhook?.receivedAt ?? null,
      lastWebhookError: lastWebhook?.errorCode ?? null,
    },
    email: {
      configured: Boolean(process.env.SMTP_HOST),
      lastDeliveryStatus: lastNotification?.status ?? null,
      lastDeliveryAt:
        lastNotification?.sentAt ?? lastNotification?.createdAt ?? null,
    },
    storage: {
      driver: (process.env.ARTIFACT_STORAGE_DRIVER ?? "local").toLowerCase(),
      configured: Boolean(
        process.env.ARTIFACT_STORAGE_DRIVER === "s3"
          ? process.env.S3_BUCKET
          : true,
      ),
    },
    google: {
      configured: Boolean(
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET,
      ),
    },
    database: { configured: true },
    web: { configured: true },
  };
}

export async function listBillingProviderEvents(organizationId?: string) {
  return database.billingProviderEvent.findMany({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      status: true,
      receivedAt: true,
      processedAt: true,
      errorCode: true,
      organizationId: true,
      provider: true,
    },
  });
}
