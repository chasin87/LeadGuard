"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { startGoogleAdsOAuth } from "@/server/google-ads/oauth";
import {
  approveGoogleAdsDestinationDomain,
  disconnectGoogleAds,
  enqueueManualGoogleAdsSync,
  ignoreGoogleAdsDestinationDomain,
  selectGoogleAdsCustomers,
  enqueueManualGoogleAdsImpact,
} from "@/server/google-ads/service";

export type GoogleAdsFormState = {
  error?: string;
};

export async function startGoogleAdsConnectAction(
  organizationSlug: string,
): Promise<void> {
  const user = await requireUser();
  const url = await startGoogleAdsOAuth({
    userId: user.id,
    organizationSlug,
  });
  redirect(url);
}

export async function selectGoogleAdsCustomersAction(
  organizationSlug: string,
  _previous: GoogleAdsFormState,
  formData: FormData,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  const googleCustomerIds = formData
    .getAll("googleCustomerId")
    .flatMap((value) => (typeof value === "string" ? [value] : []));
  try {
    await selectGoogleAdsCustomers({
      userId: user.id,
      organizationSlug,
      googleCustomerIds,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not save Google Ads accounts." };
  }
  redirect(`/app/${organizationSlug}/integrations/google-ads`);
}

export async function syncGoogleAdsCustomerAction(
  organizationSlug: string,
  googleCustomerId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await enqueueManualGoogleAdsSync({
      userId: user.id,
      organizationSlug,
      googleCustomerId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not start sync." };
  }
}

export async function approveGoogleAdsDomainAction(
  organizationSlug: string,
  targetId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await approveGoogleAdsDestinationDomain({
      userId: user.id,
      organizationSlug,
      targetId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not approve this domain." };
  }
}

export async function ignoreGoogleAdsDomainAction(
  organizationSlug: string,
  targetId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await ignoreGoogleAdsDestinationDomain({
      userId: user.id,
      organizationSlug,
      targetId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not ignore this domain." };
  }
}

export async function disconnectGoogleAdsAction(
  organizationSlug: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await disconnectGoogleAds({
      userId: user.id,
      organizationSlug,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(`/app/${organizationSlug}`, "layout");
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not disconnect Google Ads." };
  }
}

export async function refreshGoogleAdsImpactAction(
  organizationSlug: string,
  incidentId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await enqueueManualGoogleAdsImpact({
      userId: user.id,
      organizationSlug,
      incidentId,
    });
    revalidatePath(`/app/${organizationSlug}/incidents/${incidentId}`);
    revalidatePath(`/app/${organizationSlug}/incidents`);
    revalidatePath(`/app/${organizationSlug}/dashboard`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not refresh Google Ads impact." };
  }
}
