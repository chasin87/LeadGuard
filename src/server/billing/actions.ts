"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import {
  consumeRateLimit,
  clientRateLimitIdentity,
} from "@/server/auth/rate-limit";
import { getBillingConfig } from "@/server/billing/config";
import {
  createCheckoutSession,
  createPortalSession,
  refreshBillingStatus,
} from "@/server/billing/service";
import { PlanLimitError } from "@/server/billing/limits";

export type BillingFormState = {
  error?: string;
};

async function rateKey(kind: string, userId: string) {
  return `${kind}:${userId}:${clientRateLimitIdentity(await headers())}`;
}

export async function startCheckoutAction(
  organizationSlug: string,
  formData: FormData,
): Promise<BillingFormState> {
  const user = await requireUser();
  const config = getBillingConfig();
  const limit = consumeRateLimit(
    await rateKey("billing-checkout", user.id),
    config.checkoutRateLimit,
    15 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "Too many checkout attempts. Please wait and try again." };
  }
  const planKey = String(formData.get("planKey") ?? "");
  try {
    const session = await createCheckoutSession({
      userId: user.id,
      organizationSlug,
      planKey,
    });
    if (session.url) redirect(session.url);
    return { error: "Checkout could not be started." };
  } catch (error) {
    if (error instanceof DomainError || error instanceof PlanLimitError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function startPortalAction(
  organizationSlug: string,
): Promise<BillingFormState> {
  const user = await requireUser();
  const config = getBillingConfig();
  const limit = consumeRateLimit(
    await rateKey("billing-portal", user.id),
    config.portalRateLimit,
    15 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "Too many billing portal attempts. Please wait." };
  }
  try {
    const session = await createPortalSession({
      userId: user.id,
      organizationSlug,
    });
    redirect(session.url);
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function refreshBillingAction(
  organizationSlug: string,
): Promise<BillingFormState> {
  const user = await requireUser();
  const limit = consumeRateLimit(
    await rateKey("billing-refresh", user.id),
    6,
    15 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "Please wait before refreshing billing status again." };
  }
  try {
    await refreshBillingStatus({
      userId: user.id,
      organizationSlug,
    });
    return {};
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}
