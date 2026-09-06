"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { startGoogleAdsOAuth } from "@/server/google-ads/oauth";
import type { GoogleOAuthIntent } from "@/server/google-ads/scopes";
import {
  approveGoogleAdsDestinationDomain,
  disconnectGoogleAds,
  enqueueManualGoogleAdsSync,
  ignoreGoogleAdsDestinationDomain,
  selectGoogleAdsCustomers,
  enqueueManualGoogleAdsImpact,
} from "@/server/google-ads/service";
import {
  activateConversionFeedback,
  disableConversionFeedback,
  listConversionActionsForCustomer,
  queueManualConversionExport,
  retryConversionExport,
  saveConversionFeedbackConfig,
} from "@/server/google-ads/conversion-config";
import {
  disableGoogleAdsAnalytics,
  enableGoogleAdsAnalytics,
  enqueueManualAnalyticsBackfill,
  enqueueManualAnalyticsRefresh,
} from "@/server/google-ads/analytics-config";
import {
  enqueueGoogleConversionStatus,
  enqueueGoogleConversionSubmit,
} from "@/jobs/queue";
import type {
  GoogleAdsConversionEventSource,
  GoogleAdsConversionValuePolicy,
} from "@/generated/prisma/enums";

export type GoogleAdsFormState = {
  error?: string;
};

export async function startGoogleAdsConnectAction(
  organizationSlug: string,
  intent: GoogleOAuthIntent = "connect",
): Promise<void> {
  const user = await requireUser();
  const url = await startGoogleAdsOAuth({
    userId: user.id,
    organizationSlug,
    intent,
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

export async function refreshConversionActionsAction(
  organizationSlug: string,
  _previous: GoogleAdsFormState,
  formData: FormData,
): Promise<
  GoogleAdsFormState & {
    actions?: Array<{ conversionActionId: string; name: string }>;
  }
> {
  const user = await requireUser();
  const googleAdsCustomerId = String(formData.get("googleAdsCustomerId") ?? "");
  try {
    const actions = await listConversionActionsForCustomer({
      userId: user.id,
      organizationSlug,
      googleAdsCustomerId,
    });
    revalidatePath(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback`,
    );
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    return {
      actions: actions.map((item) => ({
        conversionActionId: item.conversionActionId,
        name: item.name,
      })),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not refresh conversion actions." };
  }
}

export async function saveConversionFeedbackAction(
  organizationSlug: string,
  _previous: GoogleAdsFormState,
  formData: FormData,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    const config = await saveConversionFeedbackConfig({
      userId: user.id,
      organizationSlug,
      websiteId: String(formData.get("websiteId") ?? ""),
      googleAdsCustomerId: String(formData.get("googleAdsCustomerId") ?? ""),
      conversionActionId: String(formData.get("conversionActionId") ?? ""),
      eventSource: String(
        formData.get("eventSource") ?? "OTHER",
      ) as GoogleAdsConversionEventSource,
      valuePolicy: String(
        formData.get("valuePolicy") ?? "REVENUE_IF_AVAILABLE",
      ) as GoogleAdsConversionValuePolicy,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback`,
    );
    redirect(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback?config=${config.id}`,
    );
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not save conversion feedback." };
  }
}

export async function activateConversionFeedbackAction(
  organizationSlug: string,
  configId: string,
  _previous: GoogleAdsFormState,
  formData: FormData,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await activateConversionFeedback({
      userId: user.id,
      organizationSlug,
      configId,
      confirmed: formData.get("confirmed") === "on",
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback`,
    );
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not activate conversion feedback." };
  }
}

export async function disableConversionFeedbackAction(
  organizationSlug: string,
  configId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await disableConversionFeedback({
      userId: user.id,
      organizationSlug,
      configId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback`,
    );
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not disable conversion feedback." };
  }
}

export async function retryConversionExportAction(
  organizationSlug: string,
  exportId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    const row = await retryConversionExport({
      userId: user.id,
      organizationSlug,
      exportId,
    });
    if (row.dataManagerRequestId) {
      await enqueueGoogleConversionStatus(row.id);
    } else {
      await enqueueGoogleConversionSubmit(row.id);
    }
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback`,
    );
    revalidatePath(
      `/app/${organizationSlug}/integrations/google-ads/conversion-feedback/exports`,
    );
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not retry this conversion." };
  }
}

export async function queueLeadConversionExportAction(
  organizationSlug: string,
  leadId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    const row = await queueManualConversionExport({
      userId: user.id,
      organizationSlug,
      leadId,
    });
    if (row?.status === "READY") {
      await enqueueGoogleConversionSubmit(row.id);
    }
    revalidatePath(`/app/${organizationSlug}/attribution/${leadId}`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not queue this conversion." };
  }
}

export async function enableGoogleAdsAnalyticsAction(
  organizationSlug: string,
  _previous: GoogleAdsFormState,
  formData: FormData,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");
  const googleAdsCustomerId = String(formData.get("googleAdsCustomerId") ?? "");
  try {
    await enableGoogleAdsAnalytics({
      userId: user.id,
      organizationSlug,
      websiteId,
      googleAdsCustomerId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(`/app/${organizationSlug}/analytics/revenue`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not enable revenue analytics." };
  }
}

export async function disableGoogleAdsAnalyticsAction(
  organizationSlug: string,
  configId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await disableGoogleAdsAnalytics({
      userId: user.id,
      organizationSlug,
      configId,
    });
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    revalidatePath(`/app/${organizationSlug}/analytics/revenue`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not disable revenue analytics." };
  }
}

export async function refreshGoogleAdsAnalyticsAction(
  organizationSlug: string,
  googleAdsCustomerId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await enqueueManualAnalyticsRefresh({
      userId: user.id,
      organizationSlug,
      googleAdsCustomerId,
    });
    revalidatePath(`/app/${organizationSlug}/analytics/revenue`);
    revalidatePath(`/app/${organizationSlug}/integrations/google-ads`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not refresh Google Ads analytics." };
  }
}

export async function backfillGoogleAdsAnalyticsAction(
  organizationSlug: string,
  googleAdsCustomerId: string,
): Promise<GoogleAdsFormState> {
  const user = await requireUser();
  try {
    await enqueueManualAnalyticsBackfill({
      userId: user.id,
      organizationSlug,
      googleAdsCustomerId,
    });
    revalidatePath(`/app/${organizationSlug}/analytics/revenue`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "Could not start a Google Ads performance backfill." };
  }
}
