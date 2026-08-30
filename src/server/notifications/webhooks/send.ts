import type { NotificationErrorType } from "@/generated/prisma/enums";
import type { PinnedHttpTransport } from "@/server/monitoring/pinned-transport";
import { defaultPinnedTransport } from "@/server/monitoring/pinned-transport";
import {
  assertPublicHttpTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import { UrlValidationError } from "@/server/security/errors";
import { getNotificationConfig } from "@/server/notifications/config";
import { signWebhookBody } from "@/server/notifications/webhooks/signature";
import { webhookHostname } from "@/server/notifications/privacy";
import { createLogger } from "@/server/logger";

const logger = createLogger("notifications");

export type WebhookSendInput = {
  url: string;
  secret: string;
  deliveryId: string;
  event: string;
  payload: unknown;
  resolver?: DnsResolver;
  transport?: PinnedHttpTransport;
};

export type WebhookSendResult =
  | { ok: true; httpStatus: number }
  | {
      ok: false;
      retryable: boolean;
      errorType: NotificationErrorType;
      message: string;
      httpStatus?: number;
    };

function classifyHttpStatus(status: number): {
  retryable: boolean;
  errorType: NotificationErrorType;
  message: string;
} {
  if (status === 429) {
    return {
      retryable: true,
      errorType: "RATE_LIMITED",
      message: "Webhook returned HTTP 429",
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      retryable: true,
      errorType: "PROVIDER_ERROR",
      message: `Webhook returned HTTP ${status}`,
    };
  }
  if (status >= 400 && status <= 499) {
    return {
      retryable: false,
      errorType: "PERMANENT_HTTP_ERROR",
      message: `Webhook returned HTTP ${status}`,
    };
  }
  if (status >= 300 && status <= 399) {
    return {
      retryable: false,
      errorType: "PERMANENT_HTTP_ERROR",
      message: "Webhook redirected; redirects are not followed",
    };
  }
  return {
    retryable: true,
    errorType: "UNKNOWN",
    message: `Webhook returned HTTP ${status}`,
  };
}

function classifyTransportError(error: unknown): {
  retryable: boolean;
  errorType: NotificationErrorType;
  message: string;
} {
  if (error instanceof UrlValidationError) {
    return {
      retryable: false,
      errorType: "UNSAFE_TARGET",
      message: "Webhook URL is not a public HTTP target.",
    };
  }
  const err = error as NodeJS.ErrnoException;
  if (err.code === "ETIMEDOUT" || err.code === "ABORT_ERR") {
    return {
      retryable: true,
      errorType: "TIMEOUT",
      message: "Webhook timed out",
    };
  }
  if (
    err.code === "ECONNRESET" ||
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "EHOSTUNREACH"
  ) {
    return {
      retryable: true,
      errorType: "CONNECTION_ERROR",
      message: "Could not connect to the webhook endpoint.",
    };
  }
  return {
    retryable: true,
    errorType: "UNKNOWN",
    message: "Webhook request failed",
  };
}

export async function sendSignedWebhook(
  input: WebhookSendInput,
): Promise<WebhookSendResult> {
  const config = getNotificationConfig();
  let target;
  try {
    target = await assertPublicHttpTarget(input.url, {
      resolver: input.resolver,
      originOnly: false,
    });
  } catch (error) {
    return { ok: false, ...classifyTransportError(error) };
  }

  const ip = target.resolvedAddresses[0];
  if (!ip) {
    return {
      ok: false,
      retryable: false,
      errorType: "UNSAFE_TARGET",
      message: "Webhook URL could not be resolved to a public address.",
    };
  }

  const body = JSON.stringify(input.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhookBody(input.secret, timestamp, body);
  const url = new URL(target.normalizedUrl);
  const transport = input.transport ?? defaultPinnedTransport;

  logger.info("notification.webhook.request", {
    deliveryId: input.deliveryId,
    hostname: webhookHostname(input.url),
    event: input.event,
  });

  try {
    const response = await transport({
      url,
      ip,
      method: "POST",
      body,
      timeoutMs: config.webhookTimeoutMs,
      maxBodyBytes: config.webhookMaxResponseBytes,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": config.webhookUserAgent,
        "X-LeadGuard-Event": input.event,
        "X-LeadGuard-Delivery": input.deliveryId,
        "X-LeadGuard-Timestamp": timestamp,
        "X-LeadGuard-Signature": signature,
      },
    });
    if (response.statusCode >= 200 && response.statusCode <= 299) {
      return { ok: true, httpStatus: response.statusCode };
    }
    return {
      ok: false,
      httpStatus: response.statusCode,
      ...classifyHttpStatus(response.statusCode),
    };
  } catch (error) {
    return { ok: false, ...classifyTransportError(error) };
  }
}

export type WebhookTransportOverrides = {
  resolver?: DnsResolver;
  transport?: PinnedHttpTransport;
};

let webhookOverrides: WebhookTransportOverrides = {};

export function setWebhookTransportOverrides(
  overrides: WebhookTransportOverrides,
) {
  webhookOverrides = overrides;
}

export function getWebhookTransportOverrides(): WebhookTransportOverrides {
  return webhookOverrides;
}
