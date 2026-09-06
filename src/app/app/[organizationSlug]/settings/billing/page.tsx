import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getBillingOverview } from "@/server/billing/queries";
import { overLimitCopy, usageNearLimit } from "@/server/billing/access";
import {
  CheckoutButton,
  PortalButton,
  RefreshBillingButton,
} from "@/components/billing-buttons";
import Link from "next/link";

export const metadata = { title: "Billing" };

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

export default async function BillingPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const overview = await getBillingOverview(user.id, organizationSlug);
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "billing:manage",
  );
  const { entitlements, usage, subscription, config } = overview;
  const rows = [
    ["Websites", usage.websites, entitlements.limits.maxWebsites, "websites"],
    ["Monitors", usage.monitors, entitlements.limits.maxMonitors, "monitors"],
    [
      "Form monitors",
      usage.formMonitors,
      entitlements.limits.maxFormMonitors,
      "form monitors",
    ],
    [
      "Team members",
      usage.members,
      entitlements.limits.maxOrganizationMembers,
      "team members",
    ],
    [
      "Google Ads accounts",
      usage.googleAdsCustomers,
      entitlements.limits.maxGoogleAdsCustomers,
      "Google Ads accounts",
    ],
    [
      "Outcome integrations",
      usage.outcomeIntegrations,
      entitlements.limits.maxOutcomeIntegrations,
      "outcome integrations",
    ],
  ] as const;

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Plans and usage for {access.context.organization.name}. Card details
        stay in Stripe Checkout and the Customer Portal.
      </p>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Current plan</h2>
        <p className="mt-3 text-2xl font-bold" data-testid="current-plan">
          {entitlements.planName}
        </p>
        <p
          className="mt-2 text-sm text-[var(--muted)]"
          data-testid="subscription-status"
        >
          Status: {entitlements.effectiveStatus}
        </p>
        {entitlements.status === "TRIALING" && entitlements.trialEndsAt ? (
          <p className="mt-2 text-sm" data-testid="trial-status">
            Trial ends {formatDate(entitlements.trialEndsAt)} (
            {config.trialDays} day trial).
          </p>
        ) : null}
        <p className="mt-2 text-sm text-[var(--muted)]">
          Current period ends {formatDate(entitlements.currentPeriodEnd)}
        </p>
        {subscription?.cancelAtPeriodEnd ? (
          <p className="mt-2 text-sm text-amber-800">
            Cancellation is scheduled at the end of the current period.
          </p>
        ) : null}
        {canManage ? (
          <div className="mt-6 flex flex-wrap gap-4">
            {overview.customer ? (
              <PortalButton organizationSlug={organizationSlug} />
            ) : null}
            <RefreshBillingButton organizationSlug={organizationSlug} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Only the organization owner can change billing.
          </p>
        )}
      </section>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Usage</h2>
        <ul className="mt-4 space-y-3" data-testid="plan-usage">
          {rows.map(([label, used, included, resource]) => {
            const over = used > included;
            const near = usageNearLimit(used, included);
            return (
              <li key={label}>
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className={over ? "font-semibold text-red-800" : ""}>
                    {used} / {included}
                  </span>
                </div>
                {over ? (
                  <p className="mt-1 text-sm text-red-800">
                    {overLimitCopy(resource, used, included)}
                  </p>
                ) : near ? (
                  <p className="mt-1 text-sm text-amber-800">
                    You are close to this plan limit.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        {overview.plans.map((plan) => {
          const current = entitlements.planKey === plan.key;
          return (
            <article
              className="rounded-2xl border border-[var(--border)] bg-white p-6"
              key={plan.key}
            >
              <h2 className="text-lg font-bold">{plan.name}</h2>
              <p className="mt-2 text-2xl font-bold">
                {plan.displayPrice ?? "Price set in Stripe"}
              </p>
              <ul className="mt-4 space-y-1 text-sm text-[var(--muted)]">
                <li>{plan.limits.maxWebsites} websites</li>
                <li>{plan.limits.maxMonitors} monitors</li>
                <li>{plan.limits.maxFormMonitors} form monitors</li>
                <li>{plan.limits.maxOrganizationMembers} team members</li>
              </ul>
              {current ? (
                <p className="mt-6 text-sm font-semibold">Current plan</p>
              ) : canManage ? (
                <div className="mt-6">
                  <CheckoutButton
                    organizationSlug={organizationSlug}
                    planKey={plan.key}
                    label={`Choose ${plan.name}`}
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <p className="mt-8 text-sm text-[var(--muted)]">
        {config.termsUrl ? (
          <Link
            className="font-semibold text-[#19d0a2] hover:underline"
            href={config.termsUrl}
          >
            Terms
          </Link>
        ) : (
          "Terms"
        )}
        {" · "}
        {config.privacyUrl ? (
          <Link
            className="font-semibold text-[#19d0a2] hover:underline"
            href={config.privacyUrl}
          >
            Privacy
          </Link>
        ) : (
          "Privacy"
        )}
        {" · "}
        {config.cancellationUrl ? (
          <Link
            className="font-semibold text-[#19d0a2] hover:underline"
            href={config.cancellationUrl}
          >
            Cancellation terms
          </Link>
        ) : (
          "Cancellation terms"
        )}
      </p>
    </div>
  );
}
