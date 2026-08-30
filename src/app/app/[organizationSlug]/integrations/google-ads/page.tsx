import Link from "next/link";
import { GoogleAdsAccountSelectForm } from "@/components/google-ads-account-select-form";
import { GoogleAdsApprovalControls } from "@/components/google-ads-approval-controls";
import { GoogleAdsConnectButton } from "@/components/google-ads-connect-button";
import { GoogleAdsDisconnectForm } from "@/components/google-ads-disconnect-form";
import { GoogleAdsSyncButton } from "@/components/google-ads-sync-button";
import { formatRelativeTime, healthLabel } from "@/lib/monitoring/display";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getGoogleAdsOverview } from "@/server/google-ads/service";
import { deriveMonitorHealth } from "@/server/incidents/health";
import { googleAdsStatusLabel } from "@/server/google-ads/active";

export const metadata = { title: "Google Ads" };

function connectionLabel(status: string) {
  if (status === "CONNECTED") return "Connected";
  if (status === "REAUTH_REQUIRED") return "Reconnect required";
  if (status === "DISCONNECTED") return "Disconnected";
  return "Error";
}

export default async function GoogleAdsIntegrationsPage({
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
  const overview = await getGoogleAdsOverview(user.id, organizationSlug);
  const connection = overview.connection;
  const selected = overview.customers.filter((item) => item.selected);
  const needsApproval = overview.destinations.filter(
    (item) => item.approvalStatus === "NEEDS_APPROVAL",
  );
  const unsupported = overview.destinations.filter(
    (item) => item.approvalStatus === "UNSUPPORTED",
  );
  const monitored = overview.destinations.filter(
    (item) => item.approvalStatus === "APPROVED" && item.monitorId,
  );

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/settings`}
        >
          Settings
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Google Ads</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        LeadGuard reads Final URLs from your Google Ads accounts and watches
        those landing pages. It never pauses or changes ads.
      </p>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Connection</h2>
        <p className="mt-2 text-sm">
          {connection ? connectionLabel(connection.status) : "Not connected"}
        </p>
        {connection?.googleAccountEmail ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {connection.googleAccountEmail}
          </p>
        ) : null}
        {connection?.lastSuccessfulSyncAt ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Last sync {formatRelativeTime(connection.lastSuccessfulSyncAt)}
          </p>
        ) : null}
        {canManage ? (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <GoogleAdsConnectButton
              organizationSlug={organizationSlug}
              label={
                connection?.status === "REAUTH_REQUIRED"
                  ? "Reconnect Google Ads"
                  : connection && connection.status !== "DISCONNECTED"
                    ? "Reconnect Google Ads"
                    : "Connect Google Ads"
              }
            />
            {connection && connection.status !== "DISCONNECTED" ? (
              <GoogleAdsDisconnectForm organizationSlug={organizationSlug} />
            ) : null}
          </div>
        ) : null}
      </section>

      {connection && connection.status !== "DISCONNECTED" ? (
        <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-lg font-bold">Accounts</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Select advertiser accounts. Manager accounts are login context only.
          </p>
          {canManage ? (
            <div className="mt-4">
              <GoogleAdsAccountSelectForm
                organizationSlug={organizationSlug}
                customers={overview.customers}
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-1 text-sm">
              {selected.map((customer) => (
                <li key={customer.id}>{customer.descriptiveName}</li>
              ))}
            </ul>
          )}
          {selected.length > 0 ? (
            <div className="mt-6 space-y-3">
              {selected.map((customer) => (
                <div
                  key={customer.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-sm font-semibold">
                    {customer.descriptiveName}
                  </p>
                  {canManage ? (
                    <GoogleAdsSyncButton
                      organizationSlug={organizationSlug}
                      googleCustomerId={customer.googleCustomerId}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {overview.latestSync?.status === "SUCCESS" ? (
        <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-lg font-bold">Google Ads scan complete</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Enabled source references</dt>
              <dd className="font-semibold">
                {overview.latestSync.enabledReferences}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Unique destinations</dt>
              <dd className="font-semibold">
                {overview.latestSync.uniqueDestinations}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Existing websites matched</dt>
              <dd className="font-semibold">
                {overview.latestSync.matchedWebsites}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">
                New domains needing approval
              </dt>
              <dd className="font-semibold">
                {overview.latestSync.needsApproval}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">
                Unsupported templated URLs
              </dt>
              <dd className="font-semibold">
                {overview.latestSync.unsupportedUrls}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="mt-8 max-w-5xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Destinations</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {monitored.length} monitored · {needsApproval.length} needs approval
          {overview.failingCount ? ` · ${overview.failingCount} failing` : ""}
        </p>
        {needsApproval.length > 0 ? (
          <div className="mt-6 space-y-4">
            {needsApproval.map((target) => (
              <div
                key={target.id}
                className="rounded-xl border border-amber-200 bg-amber-50 p-4"
              >
                <p className="font-semibold">
                  Google Ads discovered a new destination domain
                </p>
                <p className="mt-1 text-sm">
                  {target.monitoringUrl
                    ? new URL(target.monitoringUrl).hostname
                    : target.sourceUrl}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Used by{" "}
                  {target.references.filter((item) => item.sourceActive).length}{" "}
                  ads
                </p>
                {canManage ? (
                  <div className="mt-3">
                    <GoogleAdsApprovalControls
                      organizationSlug={organizationSlug}
                      targetId={target.id}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="text-[var(--muted)]">
                <th className="py-2 pr-4 font-semibold">Destination</th>
                <th className="py-2 pr-4 font-semibold">Google sources</th>
                <th className="py-2 pr-4 font-semibold">Google status</th>
                <th className="py-2 pr-4 font-semibold">LeadGuard status</th>
                <th className="py-2 font-semibold">Last check</th>
              </tr>
            </thead>
            <tbody>
              {overview.destinations
                .filter((item) => item.approvalStatus !== "IGNORED")
                .map((target) => {
                  const enabled = target.references.filter(
                    (item) => item.sourceActive,
                  );
                  const campaigns = new Set(
                    enabled.map((item) => item.campaignId),
                  );
                  const latest = target.monitor?.checks[0];
                  const health = target.monitor
                    ? deriveMonitorHealth({
                        latestCheck: latest ? { status: latest.status } : null,
                        hasOpenIncident: Boolean(
                          target.monitor.incidents.length,
                        ),
                      })
                    : "pending";
                  return (
                    <tr
                      key={target.id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="py-3 pr-4">
                        <Link
                          className="font-semibold text-[#19d0a2] hover:underline"
                          href={`/app/${organizationSlug}/integrations/google-ads/destinations/${target.id}`}
                        >
                          {target.monitoringUrl ?? target.sourceUrl}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        {enabled.length} ads · {campaigns.size} campaigns
                      </td>
                      <td className="py-3 pr-4">
                        {enabled.length > 0
                          ? "Enabled"
                          : googleAdsStatusLabel("PAUSED")}
                      </td>
                      <td className="py-3 pr-4">
                        {target.approvalStatus === "NEEDS_APPROVAL"
                          ? "Needs approval"
                          : target.approvalStatus === "UNSUPPORTED"
                            ? "Needs review"
                            : target.approvalStatus === "BLOCKED"
                              ? "Blocked"
                              : healthLabel(health)}
                      </td>
                      <td className="py-3">
                        {latest?.finishedAt
                          ? formatRelativeTime(latest.finishedAt)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {unsupported.length > 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            {unsupported.length} templated URL
            {unsupported.length === 1 ? "" : "s"} cannot be monitored until the
            template is resolved in Google Ads.
          </p>
        ) : null}
      </section>
    </div>
  );
}
