import "server-only";

import type {
  NotificationChannelStatus,
  NotificationEventType,
} from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { requireOrganizationRole } from "@/server/authorization/organization";
import {
  IncidentNotFoundError,
  NotificationChannelNotFoundError,
} from "@/server/security/errors";
import {
  displayWebhookUrl,
  maskEmailAddress,
} from "@/server/notifications/privacy";

export const channelListSelect = {
  id: true,
  organizationId: true,
  type: true,
  name: true,
  status: true,
  notifyOnOpened: true,
  notifyOnResolved: true,
  emailAddress: true,
  webhookUrl: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type NotificationChannelView = {
  id: string;
  type: "EMAIL" | "WEBHOOK";
  name: string;
  status: NotificationChannelStatus;
  notifyOnOpened: boolean;
  notifyOnResolved: boolean;
  emailAddress: string | null;
  maskedEmail: string | null;
  webhookDisplayUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSentAt: Date | null;
  lastFailedAt: Date | null;
};

export type NotificationDeliveryView = {
  id: string;
  eventType: NotificationEventType;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  lastErrorType: string | null;
  lastErrorMessage: string | null;
  channelName: string;
  channelType: "EMAIL" | "WEBHOOK";
  createdAt: Date;
};

export function toChannelView(
  channel: {
    id: string;
    type: "EMAIL" | "WEBHOOK";
    name: string;
    status: NotificationChannelStatus;
    notifyOnOpened: boolean;
    notifyOnResolved: boolean;
    emailAddress: string | null;
    webhookUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  stats: { lastSentAt: Date | null; lastFailedAt: Date | null },
): NotificationChannelView {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    status: channel.status,
    notifyOnOpened: channel.notifyOnOpened,
    notifyOnResolved: channel.notifyOnResolved,
    emailAddress: channel.emailAddress,
    maskedEmail: channel.emailAddress
      ? maskEmailAddress(channel.emailAddress)
      : null,
    webhookDisplayUrl: channel.webhookUrl
      ? displayWebhookUrl(channel.webhookUrl)
      : null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    lastSentAt: stats.lastSentAt,
    lastFailedAt: stats.lastFailedAt,
  };
}

export async function channelStats(channelIds: string[]) {
  if (channelIds.length === 0) {
    return new Map<
      string,
      { lastSentAt: Date | null; lastFailedAt: Date | null }
    >();
  }
  const [sent, failed] = await Promise.all([
    database.notificationDelivery.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds }, status: "SENT" },
      _max: { sentAt: true },
    }),
    database.notificationDelivery.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds }, status: "FAILED" },
      _max: { lastAttemptAt: true },
    }),
  ]);
  const map = new Map<
    string,
    { lastSentAt: Date | null; lastFailedAt: Date | null }
  >();
  for (const id of channelIds) {
    map.set(id, { lastSentAt: null, lastFailedAt: null });
  }
  for (const row of sent) {
    const current = map.get(row.channelId);
    if (current) current.lastSentAt = row._max.sentAt;
  }
  for (const row of failed) {
    const current = map.get(row.channelId);
    if (current) current.lastFailedAt = row._max.lastAttemptAt;
  }
  return map;
}

export async function listNotificationChannels(
  userId: string,
  organizationSlug: string,
): Promise<NotificationChannelView[]> {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "notifications:read",
  );
  const channels = await database.notificationChannel.findMany({
    where: { organizationId: context.organization.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: channelListSelect,
  });
  const stats = await channelStats(channels.map((channel) => channel.id));
  return channels.map((channel) =>
    toChannelView(
      channel,
      stats.get(channel.id) ?? { lastSentAt: null, lastFailedAt: null },
    ),
  );
}

export async function getNotificationChannel(
  userId: string,
  organizationSlug: string,
  channelId: string,
): Promise<NotificationChannelView & { webhookUrl: string | null }> {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "notifications:read",
  );
  const channel = await database.notificationChannel.findFirst({
    where: {
      id: channelId,
      organizationId: context.organization.id,
      deletedAt: null,
    },
    select: channelListSelect,
  });
  if (!channel) throw new NotificationChannelNotFoundError();
  const stats = await channelStats([channel.id]);
  return {
    ...toChannelView(
      channel,
      stats.get(channel.id) ?? { lastSentAt: null, lastFailedAt: null },
    ),
    webhookUrl: channel.webhookUrl,
  };
}

export async function listIncidentDeliveries(
  userId: string,
  organizationSlug: string,
  incidentId: string,
): Promise<NotificationDeliveryView[]> {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "notifications:read",
  );
  const incident = await database.incident.findFirst({
    where: {
      id: incidentId,
      monitor: { website: { organizationId: context.organization.id } },
    },
    select: { id: true },
  });
  if (!incident) {
    throw new IncidentNotFoundError();
  }
  const rows = await database.notificationDelivery.findMany({
    where: { incidentId: incident.id, organizationId: context.organization.id },
    orderBy: { createdAt: "asc" },
    include: { channel: { select: { type: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    sentAt: row.sentAt,
    lastErrorType: row.lastErrorType,
    lastErrorMessage: row.lastErrorMessage,
    channelName: row.channelName,
    channelType: row.channel.type,
    createdAt: row.createdAt,
  }));
}
