import { Prisma } from "@/generated/prisma/client";
import type { NotificationErrorType } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { getServerEnvironment } from "@/lib/env";
import { getNotificationConfig } from "@/server/notifications/config";
import { getEmailProvider } from "@/server/notifications/email/provider";
import {
  renderIncidentOpenedEmail,
  renderIncidentResolvedEmail,
  renderTestEmail,
} from "@/server/notifications/templates/email";
import {
  isIncidentNotificationPayload,
  webhookEventNames,
} from "@/server/notifications/payload";
import { nextRetryAt } from "@/server/notifications/retry";
import {
  getWebhookTransportOverrides,
  sendSignedWebhook,
} from "@/server/notifications/webhooks/send";
import { maskEmailAddress } from "@/server/notifications/privacy";

const logger = createLogger("notifications");

export type ProcessDeliveryResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; retryable: boolean; message: string }
  | { status: "already_complete" };

export async function processDelivery(
  deliveryId: string,
): Promise<ProcessDeliveryResult> {
  const claimed = await claimDelivery(deliveryId);
  if (!claimed) {
    const current = await database.notificationDelivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (current?.status === "SENT" || current?.status === "SKIPPED") {
      return { status: "already_complete" };
    }
    return { status: "skipped", reason: "not_claimable" };
  }

  logger.info("notification.delivery.started", {
    organizationId: claimed.organizationId,
    incidentId: claimed.incidentId,
    channelId: claimed.channelId,
    deliveryId: claimed.id,
    eventType: claimed.eventType,
    attempt: claimed.attemptCount,
  });

  if (claimed.channel.deletedAt || claimed.channel.status === "DISABLED") {
    await finishSkipped(claimed.id, "Channel is disabled.");
    return { status: "skipped", reason: "channel_disabled" };
  }

  const result = await sendForDelivery(claimed);
  if (result.ok) {
    await database.notificationDelivery.update({
      where: { id: claimed.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastErrorType: null,
        lastErrorMessage: null,
      },
    });
    logger.info("notification.delivery.sent", {
      organizationId: claimed.organizationId,
      incidentId: claimed.incidentId,
      channelId: claimed.channelId,
      deliveryId: claimed.id,
      eventType: claimed.eventType,
    });
    return { status: "sent" };
  }

  const retryAt = result.retryable ? nextRetryAt(claimed.attemptCount) : null;
  if (retryAt) {
    await database.notificationDelivery.update({
      where: { id: claimed.id },
      data: {
        status: "PENDING",
        nextAttemptAt: retryAt,
        lastErrorType: result.errorType,
        lastErrorMessage: result.message,
      },
    });
    logger.warn("notification.delivery.retry_scheduled", {
      organizationId: claimed.organizationId,
      incidentId: claimed.incidentId,
      channelId: claimed.channelId,
      deliveryId: claimed.id,
      eventType: claimed.eventType,
      errorType: result.errorType,
    });
    return { status: "failed", retryable: true, message: result.message };
  }

  await database.notificationDelivery.update({
    where: { id: claimed.id },
    data: {
      status: "FAILED",
      lastErrorType: result.errorType,
      lastErrorMessage: result.message,
    },
  });
  logger.warn("notification.delivery.failed", {
    organizationId: claimed.organizationId,
    incidentId: claimed.incidentId,
    channelId: claimed.channelId,
    deliveryId: claimed.id,
    eventType: claimed.eventType,
    errorType: result.errorType,
  });
  return { status: "failed", retryable: false, message: result.message };
}

async function claimDelivery(deliveryId: string) {
  const staleBefore = new Date(
    Date.now() - getNotificationConfig().staleSendingMs,
  );
  const claimed = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "NotificationDelivery"
    SET
      status = 'SENDING',
      "lastAttemptAt" = NOW(),
      "attemptCount" = "attemptCount" + 1,
      "updatedAt" = NOW()
    WHERE id = ${deliveryId}
      AND (
        (status = 'PENDING' AND "nextAttemptAt" <= NOW())
        OR (status = 'SENDING' AND "lastAttemptAt" <= ${staleBefore})
      )
    RETURNING id
  `);
  if (claimed.length !== 1) return null;

  return database.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      channel: true,
    },
  });
}

async function finishSkipped(deliveryId: string, message: string) {
  await database.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "SKIPPED",
      lastErrorMessage: message,
    },
  });
}

async function sendForDelivery(
  delivery: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>,
): Promise<
  | { ok: true }
  | {
      ok: false;
      retryable: boolean;
      errorType: NotificationErrorType;
      message: string;
    }
> {
  const channel = delivery.channel;
  if (channel.type === "EMAIL") {
    if (!channel.emailAddress) {
      return {
        ok: false,
        retryable: false,
        errorType: "PROVIDER_ERROR",
        message: "Email channel has no recipient.",
      };
    }
    const message = await buildEmailMessage(delivery);
    const provider = await getEmailProvider();
    logger.info("notification.email.send", {
      channelId: channel.id,
      deliveryId: delivery.id,
      to: maskEmailAddress(channel.emailAddress),
      provider: provider.kind,
    });
    const result = await provider.send({
      to: channel.emailAddress,
      ...message,
    });
    if (result.ok) return { ok: true };
    return result;
  }

  if (!channel.webhookUrl || !channel.webhookSecret) {
    return {
      ok: false,
      retryable: false,
      errorType: "PROVIDER_ERROR",
      message: "Webhook channel is incomplete.",
    };
  }
  const payload = await buildWebhookPayload(delivery);
  const overrides = getWebhookTransportOverrides();
  return sendSignedWebhook({
    url: channel.webhookUrl,
    secret: channel.webhookSecret,
    deliveryId: delivery.id,
    event: webhookEventNames[delivery.eventType],
    payload,
    resolver: overrides.resolver,
    transport: overrides.transport,
  });
}

async function buildEmailMessage(
  delivery: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>,
) {
  if (delivery.eventType === "NOTIFICATION_TEST") {
    return renderTestEmail(delivery.channelName);
  }
  const payload = await loadIncidentPayload(delivery);
  const incidentUrl = incidentLink(
    payload.organizationSlug,
    payload.incidentId,
  );
  if (delivery.eventType === "INCIDENT_OPENED") {
    return renderIncidentOpenedEmail(payload, incidentUrl);
  }
  return renderIncidentResolvedEmail(payload, incidentUrl);
}

async function buildWebhookPayload(
  delivery: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>,
) {
  if (delivery.eventType === "NOTIFICATION_TEST") {
    return {
      version: 1,
      event: webhookEventNames.NOTIFICATION_TEST,
      deliveryId: delivery.id,
      channelId: delivery.channelId,
    };
  }
  const payload = await loadIncidentPayload(delivery);
  return {
    version: 1,
    event: webhookEventNames[delivery.eventType],
    deliveryId: delivery.id,
    incidentId: payload.incidentId,
    website: {
      id: payload.websiteId,
      name: payload.websiteName,
      url: payload.websiteUrl,
    },
    monitor: {
      id: payload.monitorId,
      name: payload.monitorName,
      url: payload.monitorUrl,
    },
    incident: {
      status: delivery.eventType === "INCIDENT_OPENED" ? "OPEN" : "RESOLVED",
      startedAt: payload.startedAt,
      detectedAt: payload.detectedAt,
      resolvedAt: payload.resolvedAt,
      errorType: payload.errorType,
      httpStatus:
        delivery.eventType === "INCIDENT_RESOLVED"
          ? payload.recoveryHttpStatus
          : payload.httpStatus,
    },
  };
}

async function loadIncidentPayload(
  delivery: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>,
) {
  if (!delivery.incidentId) {
    throw new Error("Incident delivery is missing incidentId.");
  }
  const outbox = await database.notificationOutboxEvent.findUnique({
    where: {
      aggregateId_eventType: {
        aggregateId: delivery.incidentId,
        eventType: delivery.eventType,
      },
    },
    select: { payload: true },
  });
  if (isIncidentNotificationPayload(outbox?.payload)) {
    return outbox.payload;
  }
  throw new Error("Incident notification payload is missing.");
}

function incidentLink(organizationSlug: string, incidentId: string): string {
  const appUrl = getServerEnvironment().APP_URL.replace(/\/$/, "");
  return `${appUrl}/app/${organizationSlug}/incidents/${incidentId}`;
}
