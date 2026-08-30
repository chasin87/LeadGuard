import Link from "next/link";
import { notFound } from "next/navigation";
import { GoogleAdsApprovalControls } from "@/components/google-ads-approval-controls";
import { healthLabel } from "@/lib/monitoring/display";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { DomainError } from "@/server/authorization/errors";
import { googleAdsStatusLabel } from "@/server/google-ads/active";
import { getGoogleAdsDestination } from "@/server/google-ads/service";
import { deriveMonitorHealth } from "@/server/incidents/health";

export const metadata = { title: "Ad destination" };

function provenanceLabel(value: string) {
  if (value === "CONFIGURED_MOBILE_URL") return "Configured mobile URL";
  if (value === "OBSERVED_EXPANDED_URL") return "Observed landing page";
  return "Configured final URL";
}

export default async function GoogleAdsDestinationPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; targetId: string }>;
}) {
  const { organizationSlug, targetId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );

  let target;
  try {
    target = await getGoogleAdsDestination(user.id, organizationSlug, targetId);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }

  const latest = target.monitor?.checks[0];
  const health = target.monitor
    ? deriveMonitorHealth({
        latestCheck: latest ? { status: latest.status } : null,
        hasOpenIncident: Boolean(target.monitor.incidents.length),
      })
    : "pending";
  const sourceUrlDiffers =
    target.monitoringUrl && target.sourceUrl !== target.monitoringUrl;

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
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Destination</h1>
      <p className="mt-2 break-all text-[var(--muted)]">
        {target.monitoringUrl ?? target.sourceUrl}
      </p>
      {sourceUrlDiffers ? (
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          Google Ads source URL: {target.sourceUrl}. LeadGuard monitors the
          sanitized URL without tracking templates, gclid, or unresolved macros.
        </p>
      ) : null}

      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--muted)]">LeadGuard</dt>
            <dd className="mt-1">
              {target.approvalStatus === "NEEDS_APPROVAL"
                ? "Needs approval"
                : target.approvalStatus === "UNSUPPORTED"
                  ? "Needs review"
                  : healthLabel(health)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Account</dt>
            <dd className="mt-1">{target.customer.descriptiveName}</dd>
          </div>
        </dl>
        {target.monitor ? (
          <p className="mt-4 text-sm">
            <Link
              className="font-semibold text-[#19d0a2] hover:underline"
              href={`/app/${organizationSlug}/websites/${target.monitor.websiteId}/monitors/${target.monitor.id}`}
            >
              View monitor
            </Link>
          </p>
        ) : null}
        {target.approvalStatus === "NEEDS_APPROVAL" && canManage ? (
          <div className="mt-4">
            <GoogleAdsApprovalControls
              organizationSlug={organizationSlug}
              targetId={target.id}
            />
          </div>
        ) : null}
        {target.approvalStatus === "UNSUPPORTED" ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            This URL contains an unresolved Google Ads template and is not
            monitored.
          </p>
        ) : null}
      </section>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Google Ads sources</h2>
        <ul className="mt-4 space-y-4">
          {target.references.map((reference) => (
            <li
              key={reference.id}
              className="rounded-xl border border-[var(--border)] p-4 text-sm"
            >
              <p>
                <span className="font-semibold">Campaign</span>{" "}
                {reference.campaignName}
              </p>
              {reference.adGroupName ? (
                <p className="mt-1">
                  <span className="font-semibold">Ad group</span>{" "}
                  {reference.adGroupName}
                </p>
              ) : null}
              {reference.adId ? (
                <p className="mt-1">
                  <span className="font-semibold">Ad</span> {reference.adId}
                </p>
              ) : null}
              {reference.assetGroupName ? (
                <p className="mt-1">
                  <span className="font-semibold">Asset group</span>{" "}
                  {reference.assetGroupName}
                </p>
              ) : null}
              <p className="mt-1">
                <span className="font-semibold">Source</span>{" "}
                {provenanceLabel(reference.provenance)}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Google status</span>{" "}
                {googleAdsStatusLabel(
                  reference.adStatus ??
                    reference.assetGroupStatus ??
                    reference.campaignStatus,
                )}
                {reference.adPrimaryStatus
                  ? ` · ${googleAdsStatusLabel(reference.adPrimaryStatus)}`
                  : null}
              </p>
              {reference.provenance === "OBSERVED_EXPANDED_URL" ? (
                <p className="mt-2 text-[var(--muted)]">
                  Google Ads has recorded this expanded landing page in the
                  selected lookback period.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
