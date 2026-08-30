import "server-only";

import type { NotificationChannelStatus } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import {
  NotificationChannelNotFoundError,
  NotificationDeliveryNotFoundError,
} from "@/server/security/errors";
import {
  resolveSafeOutboundTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import { getNotificationConfig } from "@/server/notifications/config";
import { generateWebhookSecret } from "@/server/notifications/webhooks/signature";
import { processDelivery } from "@/server/notifications/delivery";
import {
  channelListSelect as notificationChannelSelect,
  channelStats,
  toChannelView,
  type NotificationChannelView,
} from "@/server/notifications/queries";

export type {
  NotificationChannelView,
  NotificationDeliveryView,
} from "@/server/notifications/queries";
export {
  getNotificationChannel,
  listIncidentDeliveries,
  listNotificationChannels,
} from "@/server/notifications/queries";

const logger = createLogger("notifications");

type ChannelMutationOptions = {
  resolver?: DnsResolver;
};

async function countActiveChannels(organizationId: string) {
  return database.notificationChannel.count({
    where: { organizationId, deletedAt: null },
  });
}

async function getOwnedChannel(organizationId: string, channelId: string) {
  const channel = await database.notificationChannel.findFirst({
    where: { id: channelId, organizationId, deletedAt: null },
    select: { ...notificationChannelSelect, webhookSecret: true },
  });
  if (!channel) throw new NotificationChannelNotFoundError();
  return channel;
}

export async function createEmailChannel(input: {
  userId: string;
  organizationSlug: string;
  name: string;
  email: string;
  notifyOnOpened: boolean;
  notifyOnResolved: boolean;
}): Promise<NotificationChannelView> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const count = await countActiveChannels(context.organization.id);
  if (count >= getNotificationConfig().maxChannelsPerOrganization) {
    throw new DomainError(
      "This organization already has the maximum number of notification channels.",
    );
  }
  const created = await database.notificationChannel.create({
    data: {
      organizationId: context.organization.id,
      type: "EMAIL",
      name: input.name,
      emailAddress: input.email,
      notifyOnOpened: input.notifyOnOpened,
      notifyOnResolved: input.notifyOnResolved,
    },
    select: notificationChannelSelect,
  });
  logger.info("notification.channel.created", {
    organizationId: context.organization.id,
    channelId: created.id,
    type: "EMAIL",
  });
  return toChannelView(created, { lastSentAt: null, lastFailedAt: null });
}

export async function createWebhookChannel(
  input: {
    userId: string;
    organizationSlug: string;
    name: string;
    url: string;
    notifyOnOpened: boolean;
    notifyOnResolved: boolean;
  },
  options: ChannelMutationOptions = {},
): Promise<NotificationChannelView & { webhookSecret: string }> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const count = await countActiveChannels(context.organization.id);
  if (count >= getNotificationConfig().maxChannelsPerOrganization) {
    throw new DomainError(
      "This organization already has the maximum number of notification channels.",
    );
  }
  const target = await resolveSafeOutboundTarget(input.url, {
    originOnly: false,
    resolver: options.resolver,
  });
  const webhookSecret = generateWebhookSecret();
  const created = await database.notificationChannel.create({
    data: {
      organizationId: context.organization.id,
      type: "WEBHOOK",
      name: input.name,
      webhookUrl: target.normalizedUrl,
      webhookSecret,
      notifyOnOpened: input.notifyOnOpened,
      notifyOnResolved: input.notifyOnResolved,
    },
    select: notificationChannelSelect,
  });
  logger.info("notification.channel.created", {
    organizationId: context.organization.id,
    channelId: created.id,
    type: "WEBHOOK",
    hostname: target.hostname,
  });
  return {
    ...toChannelView(created, { lastSentAt: null, lastFailedAt: null }),
    webhookSecret,
  };
}

export async function updateNotificationChannel(
  input: {
    userId: string;
    organizationSlug: string;
    channelId: string;
    name: string;
    email?: string;
    url?: string;
    notifyOnOpened: boolean;
    notifyOnResolved: boolean;
    status: NotificationChannelStatus;
  },
  options: ChannelMutationOptions = {},
): Promise<NotificationChannelView> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const existing = await getOwnedChannel(
    context.organization.id,
    input.channelId,
  );
  let webhookUrl = existing.webhookUrl;
  if (existing.type === "WEBHOOK" && input.url) {
    const target = await resolveSafeOutboundTarget(input.url, {
      originOnly: false,
      resolver: options.resolver,
    });
    webhookUrl = target.normalizedUrl;
  }
  const updated = await database.notificationChannel.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      notifyOnOpened: input.notifyOnOpened,
      notifyOnResolved: input.notifyOnResolved,
      status: input.status,
      emailAddress:
        existing.type === "EMAIL"
          ? (input.email ?? existing.emailAddress)
          : null,
      webhookUrl: existing.type === "WEBHOOK" ? webhookUrl : null,
    },
    select: notificationChannelSelect,
  });
  if (input.status === "DISABLED" && existing.status === "ACTIVE") {
    await skipPendingDeliveries(updated.id, "Channel was disabled.");
  }
  logger.info("notification.channel.updated", {
    organizationId: context.organization.id,
    channelId: updated.id,
  });
  const stats = await channelStats([updated.id]);
  return toChannelView(
    updated,
    stats.get(updated.id) ?? { lastSentAt: null, lastFailedAt: null },
  );
}

export async function deleteNotificationChannel(input: {
  userId: string;
  organizationSlug: string;
  channelId: string;
}): Promise<void> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const existing = await getOwnedChannel(
    context.organization.id,
    input.channelId,
  );
  await database.notificationChannel.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), status: "DISABLED" },
  });
  await skipPendingDeliveries(existing.id, "Channel was deleted.");
  logger.info("notification.channel.updated", {
    organizationId: context.organization.id,
    channelId: existing.id,
    deleted: true,
  });
}

export async function revealWebhookSecret(input: {
  userId: string;
  organizationSlug: string;
  channelId: string;
}): Promise<string> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const channel = await getOwnedChannel(
    context.organization.id,
    input.channelId,
  );
  if (channel.type !== "WEBHOOK" || !channel.webhookSecret) {
    throw new DomainError("This channel does not have a signing secret.");
  }
  return channel.webhookSecret;
}

export async function rotateWebhookSecret(input: {
  userId: string;
  organizationSlug: string;
  channelId: string;
}): Promise<string> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const existing = await getOwnedChannel(
    context.organization.id,
    input.channelId,
  );
  if (existing.type !== "WEBHOOK") {
    throw new DomainError("Only webhook channels have a signing secret.");
  }
  const webhookSecret = generateWebhookSecret();
  await database.notificationChannel.update({
    where: { id: existing.id },
    data: { webhookSecret },
  });
  logger.info("notification.channel.updated", {
    organizationId: context.organization.id,
    channelId: existing.id,
    rotated: true,
  });
  return webhookSecret;
}

export async function sendTestNotification(input: {
  userId: string;
  organizationSlug: string;
  channelId: string;
}): Promise<ProcessDeliveryResultLike> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const channel = await getOwnedChannel(
    context.organization.id,
    input.channelId,
  );
  const limit = consumeRateLimit(
    `notification-test:${channel.id}`,
    1,
    getNotificationConfig().testCooldownMs,
  );
  if (!limit.ok) {
    throw new DomainError(
      "Please wait before sending another test notification.",
    );
  }
  if (channel.status !== "ACTIVE") {
    throw new DomainError(
      "Enable the channel before sending a test notification.",
    );
  }
  const delivery = await database.notificationDelivery.create({
    data: {
      organizationId: context.organization.id,
      channelId: channel.id,
      eventType: "NOTIFICATION_TEST",
      idempotencyKey: `test:${channel.id}:${crypto.randomUUID()}`,
      status: "PENDING",
      channelName: channel.name,
    },
    select: { id: true },
  });
  logger.info("notification.channel.tested", {
    organizationId: context.organization.id,
    channelId: channel.id,
    deliveryId: delivery.id,
    eventType: "NOTIFICATION_TEST",
  });
  return processDelivery(delivery.id);
}

export async function retryFailedDelivery(input: {
  userId: string;
  organizationSlug: string;
  deliveryId: string;
}): Promise<ProcessDeliveryResultLike> {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "notifications:manage",
  );
  const limit = consumeRateLimit(
    `notification-retry:${input.deliveryId}`,
    1,
    getNotificationConfig().testCooldownMs,
  );
  if (!limit.ok) {
    throw new DomainError("Please wait before retrying this delivery.");
  }
  const delivery = await database.notificationDelivery.findFirst({
    where: {
      id: input.deliveryId,
      organizationId: context.organization.id,
    },
    select: { id: true, status: true, eventType: true },
  });
  if (!delivery) throw new NotificationDeliveryNotFoundError();
  if (delivery.eventType === "NOTIFICATION_TEST") {
    throw new DomainError("Retry a test by sending a new test notification.");
  }
  if (delivery.status !== "FAILED") {
    throw new DomainError("Only failed deliveries can be retried.");
  }
  await database.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(),
    },
  });
  return processDelivery(delivery.id);
}

async function skipPendingDeliveries(channelId: string, message: string) {
  await database.notificationDelivery.updateMany({
    where: { channelId, status: { in: ["PENDING", "SENDING"] } },
    data: { status: "SKIPPED", lastErrorMessage: message },
  });
}

type ProcessDeliveryResultLike = Awaited<ReturnType<typeof processDelivery>>;
