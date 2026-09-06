import { Prisma } from "@/generated/prisma/client";
import type { OrganizationEntitlements } from "@/server/billing/entitlements";

export function billingAllowsMonitoringSql(now: Date) {
  return Prisma.sql`
    AND (
      NOT EXISTS (
        SELECT 1 FROM "BillingSubscription" bs
        WHERE bs."organizationId" = w."organizationId"
      )
      OR EXISTS (
        SELECT 1 FROM "BillingSubscription" bs
        WHERE bs."organizationId" = w."organizationId"
          AND bs.status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD')
          AND (
            bs.status <> 'TRIALING'
            OR bs."trialEnd" IS NULL
            OR bs."trialEnd" > ${now}
          )
          AND (
            bs.status NOT IN ('PAST_DUE', 'GRACE_PERIOD')
            OR bs."graceDeadlineAt" IS NULL
            OR bs."graceDeadlineAt" > ${now}
          )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM "Organization" org
      WHERE org.id = w."organizationId"
        AND org."manualSuspendedAt" IS NOT NULL
    )
  `;
}

export function billingWhereMonitoringEnabled(now: Date) {
  return {
    OR: [
      { billingSubscription: null },
      {
        billingSubscription: {
          status: { in: ["TRIALING", "ACTIVE"] as const },
          OR: [{ trialEnd: null }, { trialEnd: { gt: now } }],
        },
      },
      {
        billingSubscription: {
          status: { in: ["PAST_DUE", "GRACE_PERIOD"] as const },
          OR: [{ graceDeadlineAt: null }, { graceDeadlineAt: { gt: now } }],
        },
      },
    ],
  };
}

export function daysRemaining(from: Date, now: Date): number {
  return Math.max(0, Math.ceil((from.getTime() - now.getTime()) / 86_400_000));
}

export function usageNearLimit(used: number, included: number): boolean {
  if (included <= 0) return false;
  return used / included >= 0.8 && used < included;
}

export function overLimitCopy(
  resource: string,
  used: number,
  included: number,
): string {
  const extra = used - included;
  return `Your organization uses ${used} ${resource}. Your current plan supports ${included}. Remove ${extra} ${resource} or upgrade.`;
}

export function billingBanner(
  entitlements: OrganizationEntitlements,
  now = new Date(),
): { tone: "info" | "warning" | "danger"; message: string } | null {
  if (entitlements.manualSuspended) {
    return {
      tone: "danger",
      message:
        "This organization is suspended. Existing data is kept. New monitoring and billable changes are paused.",
    };
  }
  if (entitlements.effectiveStatus === "SUSPENDED") {
    return {
      tone: "danger",
      message:
        "Monitoring suspended because subscription payment is overdue. Update your payment method to restore monitoring.",
    };
  }
  if (entitlements.effectiveStatus === "TRIAL_EXPIRED") {
    return {
      tone: "danger",
      message:
        "Your trial has ended. Choose a plan to keep LeadGuard protecting your leads.",
    };
  }
  if (
    entitlements.effectiveStatus === "GRACE_PERIOD" &&
    entitlements.graceDeadlineAt
  ) {
    const deadline = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    }).format(entitlements.graceDeadlineAt);
    return {
      tone: "warning",
      message: `Payment failed. Update your payment method before ${deadline} to keep monitoring active.`,
    };
  }
  if (entitlements.effectiveStatus === "PAST_DUE") {
    return {
      tone: "warning",
      message:
        "Payment failed. Update your payment method to keep monitoring active.",
    };
  }
  if (entitlements.overLimit) {
    return {
      tone: "warning",
      message:
        "Plan limit exceeded. Existing resources stay active. Remove extra resources or upgrade to add more.",
    };
  }
  if (
    entitlements.status === "TRIALING" &&
    entitlements.trialEndsAt &&
    entitlements.trialEndsAt > now
  ) {
    const days = daysRemaining(entitlements.trialEndsAt, now);
    return {
      tone: "info",
      message:
        days === 1
          ? "Your trial ends in 1 day."
          : `Your trial ends in ${days} days.`,
    };
  }
  if (entitlements.cancelAtPeriodEnd && entitlements.currentPeriodEnd) {
    const when = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    }).format(entitlements.currentPeriodEnd);
    return {
      tone: "info",
      message: `Your subscription stays active until ${when}.`,
    };
  }
  return null;
}
