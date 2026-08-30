import { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { getNotificationConfig } from "@/server/notifications/config";
import {
  incidentDeliveryIdempotencyKey,
  isIncidentNotificationPayload,
  type IncidentNotificationEventType,
} from "@/server/notifications/payload";
import { enqueueNotificationDelivery } from "@/jobs/queue";

const logger = createLogger("notifications");

type OutboxRow = {
  id: string;
  organizationId: string;
  eventType: IncidentNotificationEventType;
  aggregateId: string;
  payload: Prisma.JsonValue;
};

function channelMatchesEvent(
  channel: { notifyOnOpened: boolean; notifyOnResolved: boolean },
  eventType: IncidentNotificationEventType,
) {
  if (eventType === "INCIDENT_OPENED") return channel.notifyOnOpened;
  return channel.notifyOnResolved;
}

export async function dispatchPendingOutboxEvents(
  limit = getNotificationConfig().dispatcherBatchSize,
): Promise<number> {
  const claimed = await database.$transaction(async (tx) => {
    const events = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
      SELECT id, "organizationId", "eventType", "aggregateId", payload
      FROM "NotificationOutboxEvent"
      WHERE status = 'PENDING' AND "availableAt" <= NOW()
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    if (events.length === 0) return [] as Array<{ deliveryIds: string[] }>;

    const processed: Array<{ deliveryIds: string[] }> = [];
    for (const event of events) {
      const deliveryIds = await fanOutEvent(tx, event);
      await tx.notificationOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      logger.info("notification.outbox.processed", {
        organizationId: event.organizationId,
        incidentId: event.aggregateId,
        eventType: event.eventType,
        deliveries: deliveryIds.length,
      });
      processed.push({ deliveryIds });
    }
    return processed;
  });

  const ids = claimed.flatMap((row) => row.deliveryIds);
  for (const deliveryId of ids) {
    await enqueueNotificationDelivery(deliveryId);
  }
  return ids.length;
}

async function fanOutEvent(
  tx: Prisma.TransactionClient,
  event: OutboxRow,
): Promise<string[]> {
  if (
    event.eventType !== "INCIDENT_OPENED" &&
    event.eventType !== "INCIDENT_RESOLVED"
  ) {
    return [];
  }
  const payload = isIncidentNotificationPayload(event.payload)
    ? event.payload
    : null;
  const channels = await tx.notificationChannel.findMany({
    where: {
      organizationId: event.organizationId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      notifyOnOpened: true,
      notifyOnResolved: true,
    },
  });
  const matching = channels.filter((channel) =>
    channelMatchesEvent(channel, event.eventType),
  );
  if (matching.length === 0) {
    return [];
  }

  const created: string[] = [];
  for (const channel of matching) {
    const idempotencyKey = incidentDeliveryIdempotencyKey(
      event.aggregateId,
      event.eventType,
      channel.id,
    );
    const row = await tx.notificationDelivery.upsert({
      where: { idempotencyKey },
      create: {
        organizationId: event.organizationId,
        incidentId: event.aggregateId,
        channelId: channel.id,
        eventType: event.eventType,
        idempotencyKey,
        status: "PENDING",
        channelName: channel.name,
        websiteName: payload?.websiteName,
        monitorName: payload?.monitorName,
        monitorUrl: payload?.monitorUrl,
      },
      update: {},
      select: { id: true, status: true },
    });
    if (row.status === "PENDING") {
      created.push(row.id);
    }
    logger.info("notification.delivery.queued", {
      organizationId: event.organizationId,
      incidentId: event.aggregateId,
      channelId: channel.id,
      deliveryId: row.id,
      eventType: event.eventType,
    });
  }
  return created;
}

export async function enqueueDueNotificationDeliveries(
  limit = 50,
): Promise<number> {
  const staleBefore = new Date(
    Date.now() - getNotificationConfig().staleSendingMs,
  );
  const due = await database.notificationDelivery.findMany({
    where: {
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: new Date() } },
        { status: "SENDING", lastAttemptAt: { lte: staleBefore } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const row of due) {
    await enqueueNotificationDelivery(row.id);
  }
  return due.length;
}
