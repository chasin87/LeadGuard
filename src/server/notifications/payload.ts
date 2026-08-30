import type { NotificationEventType } from "@/generated/prisma/enums";

export const incidentNotificationEvents = [
  "INCIDENT_OPENED",
  "INCIDENT_RESOLVED",
] as const satisfies ReadonlyArray<NotificationEventType>;

export type IncidentNotificationEventType =
  (typeof incidentNotificationEvents)[number];

export const webhookEventNames = {
  INCIDENT_OPENED: "incident.opened",
  INCIDENT_RESOLVED: "incident.resolved",
  NOTIFICATION_TEST: "notification.test",
} as const satisfies Record<NotificationEventType, string>;

export type IncidentNotificationPayloadV1 = {
  version: 1;
  eventType: IncidentNotificationEventType;
  organizationId: string;
  organizationSlug: string;
  incidentId: string;
  monitorId: string;
  websiteId: string;
  websiteName: string;
  websiteHostname: string;
  websiteUrl: string;
  monitorName: string;
  monitorUrl: string;
  startedAt: string;
  detectedAt: string;
  resolvedAt: string | null;
  errorType: string | null;
  errorMessage: string | null;
  httpStatus: number | null;
  recoveryHttpStatus: number | null;
  durationMs: number | null;
  googleAds?: {
    enabledReferenceCount: number;
    campaignNames: string[];
    additionalCampaignCount: number;
    impactStatus?: string;
    impactCostMicros?: string;
    impactCurrency?: string;
    impactConfidence?: string;
  } | null;
};

export function isIncidentNotificationPayload(
  value: unknown,
): value is IncidentNotificationPayloadV1 {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    (payload.eventType === "INCIDENT_OPENED" ||
      payload.eventType === "INCIDENT_RESOLVED") &&
    typeof payload.incidentId === "string" &&
    typeof payload.organizationSlug === "string"
  );
}

export function incidentDeliveryIdempotencyKey(
  incidentId: string,
  eventType: IncidentNotificationEventType,
  channelId: string,
): string {
  return `${incidentId}:${eventType}:${channelId}`;
}
