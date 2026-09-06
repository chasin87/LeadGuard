import Link from "next/link";
import { ConversionFeedbackActivateForm } from "@/components/conversion-feedback-activate-form";
import { ConversionFeedbackSetupForm } from "@/components/conversion-feedback-setup-form";
import { GoogleAdsConnectButton } from "@/components/google-ads-connect-button";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getConversionFeedbackOverview } from "@/server/google-ads/conversion-config";

export const metadata = { title: "Conversion feedback" };

function valuePolicyLabel(policy: string) {
  if (policy === "REQUIRE_REVENUE") return "Require realized revenue";
  if (policy === "NO_VALUE") return "No conversion value";
  return "Realized revenue when available";
}

export default async function ConversionFeedbackPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );
  const overview = await getConversionFeedbackOverview(
    user.id,
    organizationSlug,
  );

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/integrations/google-ads`}
        >
          Google Ads
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Conversion feedback
      </h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Map a website to a Google Ads conversion action. LeadGuard does not
        create conversion actions and does not upload historical won leads
        unless you queue them explicitly.
      </p>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Data Manager</h2>
        <p className="mt-2 text-sm" data-testid="data-manager-status">
          {overview.capabilities.dataManagerStatus === "READY"
            ? "Data Manager Connected"
            : overview.capabilities.dataManagerStatus === "REAUTH_REQUIRED"
              ? "Additional Google permission required"
              : "Not configured"}
        </p>
        {canManage && overview.capabilities.dataManagerStatus !== "READY" ? (
          <div className="mt-4">
            <GoogleAdsConnectButton
              organizationSlug={organizationSlug}
              intent="data_manager"
              label="Enable conversion feedback"
            />
          </div>
        ) : null}
      </section>

      {overview.configs.map((config) => (
        <section
          className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6"
          key={config.id}
        >
          <h2 className="text-lg font-bold">Google Ads Conversion Feedback</h2>
          <p
            className="mt-2 text-sm font-semibold"
            data-testid="conversion-feedback-status"
          >
            {config.status === "ACTIVE" ? "Active" : config.status}
          </p>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-[var(--muted)]">Website</dt>
              <dd className="mt-1">{config.website.name}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Account</dt>
              <dd className="mt-1">{config.customer.descriptiveName}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                Conversion action
              </dt>
              <dd className="mt-1">{config.conversionActionNameSnapshot}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Value</dt>
              <dd className="mt-1">{valuePolicyLabel(config.valuePolicy)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                Event source
              </dt>
              <dd className="mt-1">{config.eventSource}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                Data Manager
              </dt>
              <dd className="mt-1">
                {overview.capabilities.dataManagerStatus === "READY"
                  ? "Connected"
                  : "Additional Google permission required"}
              </dd>
            </div>
          </dl>
          {canManage ? (
            <div className="mt-6">
              <ConversionFeedbackActivateForm
                organizationSlug={organizationSlug}
                configId={config.id}
                active={config.status === "ACTIVE"}
              />
            </div>
          ) : null}
        </section>
      ))}

      {canManage ? (
        <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-lg font-bold">Setup</h2>
          <ConversionFeedbackSetupForm
            organizationSlug={organizationSlug}
            websites={overview.websites}
            customers={overview.customers}
          />
        </section>
      ) : null}
    </div>
  );
}
