"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { WebsiteNotFoundError } from "@/server/security/errors";
import {
  disableTrackingForWebsite,
  enableTrackingForWebsite,
  rotateTrackingSecretsForWebsite,
} from "@/server/tracking/actions-service";
import { getWebsiteTrackingView } from "@/server/tracking/queries";

export type TrackingFormState = {
  error?: string;
  siteKey?: string;
  serverSecret?: string;
};

function trackingActionError(error: unknown): TrackingFormState {
  if (error instanceof AuthorizationError) {
    return { error: "You do not have permission to manage tracking." };
  }
  if (error instanceof WebsiteNotFoundError || error instanceof DomainError) {
    return { error: error.message };
  }
  throw error;
}

export async function enableTrackingAction(
  organizationSlug: string,
  websiteId: string,
  _previous: TrackingFormState,
  _formData: FormData,
): Promise<TrackingFormState> {
  void _previous;
  void _formData;
  const user = await requireUser();
  const limit = consumeRateLimit(`tracking-enable:${user.id}`, 10);
  if (!limit.ok)
    return { error: "Too many attempts. Please wait and try again." };
  try {
    const result = await enableTrackingForWebsite({
      userId: user.id,
      organizationSlug,
      websiteId,
    });
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}`);
    revalidatePath(`/app/${organizationSlug}/attribution`);
    return { siteKey: result.siteKey, serverSecret: result.serverSecret };
  } catch (error) {
    return trackingActionError(error);
  }
}

export async function disableTrackingAction(
  organizationSlug: string,
  websiteId: string,
  _formData: FormData,
): Promise<void> {
  void _formData;
  const user = await requireUser();
  try {
    await disableTrackingForWebsite({
      userId: user.id,
      organizationSlug,
      websiteId,
    });
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}`);
  } catch (error) {
    trackingActionError(error);
  }
}

export async function rotateTrackingSecretsAction(
  organizationSlug: string,
  websiteId: string,
  _previous: TrackingFormState,
  formData: FormData,
): Promise<TrackingFormState> {
  void _previous;
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "server");
  try {
    const result = await rotateTrackingSecretsForWebsite({
      userId: user.id,
      organizationSlug,
      websiteId,
      kind: kind === "site" ? "site" : "server",
    });
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}`);
    return result;
  } catch (error) {
    return trackingActionError(error);
  }
}

export async function verifyTrackingInstallationAction(
  organizationSlug: string,
  websiteId: string,
  _formData: FormData,
): Promise<void> {
  void _formData;
  const user = await requireUser();
  try {
    await getWebsiteTrackingView(user.id, organizationSlug, websiteId);
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}`);
    revalidatePath(`/app/${organizationSlug}/attribution`);
  } catch (error) {
    trackingActionError(error);
  }
}
