import { DomainError } from "@/server/authorization/errors";

export type UrlValidationReason =
  | "invalid_url"
  | "unsupported_scheme"
  | "credentials_not_allowed"
  | "origin_only"
  | "port_not_allowed"
  | "private_target"
  | "internal_hostname"
  | "duplicate_website"
  | "dns_failed";

export class UrlValidationError extends DomainError {
  readonly reason: UrlValidationReason;

  constructor(message: string, reason: UrlValidationReason) {
    super(message);
    this.name = "UrlValidationError";
    this.reason = reason;
  }
}

export class WebsiteNotFoundError extends Error {
  readonly status = 404;
  readonly code = "WEBSITE_NOT_FOUND";

  constructor(message = "Website not found.") {
    super(message);
    this.name = "WebsiteNotFoundError";
  }
}

export class MonitorNotFoundError extends Error {
  readonly status = 404;
  readonly code = "MONITOR_NOT_FOUND";

  constructor(message = "Monitor not found.") {
    super(message);
    this.name = "MonitorNotFoundError";
  }
}

export class IncidentNotFoundError extends Error {
  readonly status = 404;
  readonly code = "INCIDENT_NOT_FOUND";

  constructor(message = "Incident not found.") {
    super(message);
    this.name = "IncidentNotFoundError";
  }
}

export class NotificationChannelNotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOTIFICATION_CHANNEL_NOT_FOUND";

  constructor(message = "Notification channel not found.") {
    super(message);
    this.name = "NotificationChannelNotFoundError";
  }
}

export class NotificationDeliveryNotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOTIFICATION_DELIVERY_NOT_FOUND";

  constructor(message = "Notification delivery not found.") {
    super(message);
    this.name = "NotificationDeliveryNotFoundError";
  }
}
