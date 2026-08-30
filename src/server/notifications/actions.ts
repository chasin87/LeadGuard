"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createEmailChannelSchema,
  createWebhookChannelSchema,
  updateNotificationChannelSchema,
} from "@/lib/validation/notification";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import {
  IncidentNotFoundError,
  NotificationChannelNotFoundError,
  NotificationDeliveryNotFoundError,
} from "@/server/security/errors";
import {
  createEmailChannel,
  createWebhookChannel,
  deleteNotificationChannel,
  revealWebhookSecret,
  retryFailedDelivery,
  rotateWebhookSecret,
  sendTestNotification,
  updateNotificationChannel,
} from "@/server/notifications/service";
import { UrlValidationError } from "@/server/security/errors";

export type NotificationFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  secret?: string;
  revealed?: string;
  testStatus?: string;
};

function checkbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

async function rateLimitKey(kind: string, userId: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    "unknown";
  return `${kind}:${userId}:${ip}`;
}

function revalidateNotificationPaths(
  organizationSlug: string,
  extras: string[] = [],
) {
  revalidatePath(`/app/${organizationSlug}/settings/notifications`);
  for (const extra of extras) revalidatePath(extra);
}

export async function createEmailChannelAction(
  organizationSlug: string,
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const user = await requireUser();
  const limit = consumeRateLimit(
    await rateLimitKey("notification-create", user.id),
    20,
  );
  if (!limit.ok) {
    return { error: "Too many attempts. Please wait and try again." };
  }
  const parsed = createEmailChannelSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    notifyOnOpened: checkbox(formData, "notifyOnOpened"),
    notifyOnResolved: checkbox(formData, "notifyOnResolved"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await createEmailChannel({
      userId: user.id,
      organizationSlug,
      ...parsed.data,
    });
  } catch (error) {
    return mapMutationError(error);
  }
  redirect(`/app/${organizationSlug}/settings/notifications`);
}

export async function createWebhookChannelAction(
  organizationSlug: string,
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const user = await requireUser();
  const limit = consumeRateLimit(
    await rateLimitKey("notification-create", user.id),
    20,
  );
  if (!limit.ok) {
    return { error: "Too many attempts. Please wait and try again." };
  }
  const parsed = createWebhookChannelSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    notifyOnOpened: checkbox(formData, "notifyOnOpened"),
    notifyOnResolved: checkbox(formData, "notifyOnResolved"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const created = await createWebhookChannel({
      userId: user.id,
      organizationSlug,
      ...parsed.data,
    });
    revalidateNotificationPaths(organizationSlug);
    return { secret: created.webhookSecret };
  } catch (error) {
    return mapMutationError(error);
  }
}

export async function updateNotificationChannelAction(
  organizationSlug: string,
  channelId: string,
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const user = await requireUser();
  const parsed = updateNotificationChannelSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") || undefined,
    url: formData.get("url") || undefined,
    notifyOnOpened: checkbox(formData, "notifyOnOpened"),
    notifyOnResolved: checkbox(formData, "notifyOnResolved"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateNotificationChannel({
      userId: user.id,
      organizationSlug,
      channelId,
      ...parsed.data,
    });
  } catch (error) {
    return mapMutationError(error);
  }
  redirect(`/app/${organizationSlug}/settings/notifications`);
}

export async function deleteNotificationChannelAction(
  organizationSlug: string,
  channelId: string,
): Promise<void> {
  const user = await requireUser();
  await deleteNotificationChannel({
    userId: user.id,
    organizationSlug,
    channelId,
  });
  redirect(`/app/${organizationSlug}/settings/notifications`);
}

export async function sendTestNotificationAction(
  organizationSlug: string,
  channelId: string,
): Promise<NotificationFormState> {
  const user = await requireUser();
  try {
    const result = await sendTestNotification({
      userId: user.id,
      organizationSlug,
      channelId,
    });
    revalidateNotificationPaths(organizationSlug, [
      `/app/${organizationSlug}/settings/notifications/${channelId}`,
    ]);
    if (result.status === "sent") return { testStatus: "sent" };
    if (result.status === "failed") {
      return { error: result.message, testStatus: "failed" };
    }
    return { error: "Test notification was skipped.", testStatus: "skipped" };
  } catch (error) {
    return mapMutationError(error);
  }
}

export async function revealWebhookSecretAction(
  organizationSlug: string,
  channelId: string,
): Promise<NotificationFormState> {
  const user = await requireUser();
  try {
    const revealed = await revealWebhookSecret({
      userId: user.id,
      organizationSlug,
      channelId,
    });
    return { revealed };
  } catch (error) {
    return mapMutationError(error);
  }
}

export async function rotateWebhookSecretAction(
  organizationSlug: string,
  channelId: string,
): Promise<NotificationFormState> {
  const user = await requireUser();
  try {
    const revealed = await rotateWebhookSecret({
      userId: user.id,
      organizationSlug,
      channelId,
    });
    revalidateNotificationPaths(organizationSlug);
    return { secret: revealed };
  } catch (error) {
    return mapMutationError(error);
  }
}

export async function retryFailedDeliveryAction(
  organizationSlug: string,
  incidentId: string,
  deliveryId: string,
): Promise<NotificationFormState> {
  const user = await requireUser();
  try {
    const result = await retryFailedDelivery({
      userId: user.id,
      organizationSlug,
      deliveryId,
    });
    revalidatePath(`/app/${organizationSlug}/incidents/${incidentId}`);
    if (result.status === "sent") return { testStatus: "sent" };
    if (result.status === "failed") {
      return { error: result.message, testStatus: "failed" };
    }
    return { error: "Delivery was skipped.", testStatus: "skipped" };
  } catch (error) {
    return mapMutationError(error);
  }
}

function mapMutationError(error: unknown): NotificationFormState {
  if (error instanceof AuthorizationError) {
    return { error: "You do not have permission to manage notifications." };
  }
  if (error instanceof UrlValidationError) {
    return { error: error.message };
  }
  if (error instanceof DomainError) {
    return { error: error.message };
  }
  if (
    error instanceof NotificationChannelNotFoundError ||
    error instanceof NotificationDeliveryNotFoundError ||
    error instanceof IncidentNotFoundError
  ) {
    return { error: error.message };
  }
  throw error;
}
