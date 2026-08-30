import Link from "next/link";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getOrganizationDashboardStats } from "@/server/incidents/service";
import { checkIncidentHeadline } from "@/lib/monitoring/display";
import { formatDuration, incidentDurationMs } from "@/lib/incidents/duration";
import { formatCurrencyFromMicros } from "@/lib/google-ads/money";

export const metadata = { title: "Dashboard" };

export default async function OrganizationDashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") {
    return null;
  }
  const context = access.context;
  const stats = await getOrganizationDashboardStats(user.id, organizationSlug);
  const canManage = hasOrganizationPermission(
    context.membership.role,
    "websites:manage",
  );
  const websitesHref = `/app/${organizationSlug}/websites`;
  const incidentsHref = `/app/${organizationSlug}/incidents`;

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Live counts for {context.organization.name}. Incidents open only after
        consecutive failed checks.
      </p>
      <section
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Kerncijfers"
      >
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Websites</p>
          <p className="mt-4 text-3xl font-bold">{stats.websiteCount}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Active incidents</p>
          <p className="mt-4 text-3xl font-bold">{stats.openIncidentCount}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Failing monitors</p>
          <p className="mt-4 text-3xl font-bold">{stats.failingMonitorCount}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Checks last 24h</p>
          <p className="mt-4 text-3xl font-bold">
            {stats.checksLast24h.toLocaleString("en-GB")}
          </p>
        </article>
        {stats.adsSpendAtRisk.length > 0 ? (
          <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <p className="text-sm text-[var(--muted)]">
              Current estimated spend at risk
            </p>
            <div className="mt-4 space-y-1">
              {stats.adsSpendAtRisk.map((row) => (
                <p className="text-3xl font-bold" key={row.currencyCode}>
                  {formatCurrencyFromMicros(row.costMicros, row.currencyCode)}
                </p>
              ))}
            </div>
          </article>
        ) : null}
      </section>

      <section className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Active incidents</h2>
          <Link
            className="text-sm font-semibold text-[#19d0a2] hover:underline"
            href={incidentsHref}
          >
            View incidents
          </Link>
        </div>
        {stats.openIncidents.length === 0 ? (
          <p className="mt-4 text-[var(--muted)]">No open incidents.</p>
        ) : (
          <ul className="mt-5 space-y-4">
            {stats.openIncidents.map((incident) => (
              <li key={incident.id}>
                <Link
                  className="block rounded-xl border border-[var(--border)] p-4 hover:bg-slate-50"
                  href={`${incidentsHref}/${incident.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{incident.monitor.name}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {incident.monitor.website.hostname}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {checkIncidentHeadline(incident.latestErrorType, null)}
                        {" · "}
                        {formatDuration(
                          incidentDurationMs(incident.startedAt, null),
                        )}
                      </p>
                    </div>
                    <IncidentStatusBadge status="OPEN" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-8">
        {stats.websiteCount === 0 ? (
          <>
            <h2 className="text-xl font-bold">No websites yet</h2>
            <p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">
              Add the first website you want LeadGuard to protect.
            </p>
            {canManage ? (
              <Link
                className="mt-6 inline-flex rounded-xl bg-[#19d0a2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#193f36]"
                href={`${websitesHref}/new`}
              >
                Add website
              </Link>
            ) : (
              <Link
                className="mt-6 inline-flex text-sm font-semibold text-[#19d0a2] hover:underline"
                href={websitesHref}
              >
                View websites
              </Link>
            )}
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold">Websites</h2>
            <p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">
              This organization has {stats.websiteCount}{" "}
              {stats.websiteCount === 1 ? "website" : "websites"} configured.
            </p>
            <Link
              className="mt-6 inline-flex text-sm font-semibold text-[#19d0a2] hover:underline"
              href={websitesHref}
            >
              View websites
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
