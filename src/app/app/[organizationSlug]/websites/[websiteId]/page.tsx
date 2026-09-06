import Link from "next/link";
import { notFound } from "next/navigation";
import {
  WebsiteDnsNote,
  WebsiteStatusBadge,
} from "@/components/website-status-badge";
import { WebsiteStatusForm } from "@/components/website-status-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { MonitorHealthBadge } from "@/components/monitor-health-badge";
import { WebsiteNotFoundError } from "@/server/security/errors";
import { listMonitors } from "@/server/monitors/service";
import { getWebsite } from "@/server/websites/service";
import { database } from "@/server/database";
import {
  deriveMonitorHealth,
  deriveWebsiteHealth,
} from "@/server/incidents/health";
import {
  checkErrorLabel,
  formatInterval,
  formatRelativeTime,
  healthLabel,
  monitorTypeLabel,
} from "@/lib/monitoring/display";
import { formatDuration, incidentDurationMs } from "@/lib/incidents/duration";
import { WebsiteTrackingSetup } from "@/components/website-tracking-setup";
import { trackingSdkUrl } from "@/server/tracking/config";

export const metadata = { title: "Website" };

function formatAddedDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function WebsiteDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; websiteId: string }>;
}) {
  const { organizationSlug, websiteId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") {
    return null;
  }

  let website;
  try {
    website = await getWebsite(user.id, organizationSlug, websiteId);
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      notFound();
    }
    throw error;
  }

  const monitors = await listMonitors(user.id, organizationSlug, websiteId);
  const tracking = await database.websiteTrackingConfig.findUnique({
    where: { websiteId: website.id },
  });
  const monitorHealths = monitors.map((monitor) =>
    deriveMonitorHealth({
      latestCheck: monitor.latestCheck,
      hasOpenIncident: Boolean(monitor.openIncident),
      receiptStatus: monitor.latestCheck?.leadReceiptVerification?.status,
    }),
  );
  const websiteHealth = deriveWebsiteHealth(monitorHealths);
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "websites:manage",
  );
  const base = `/app/${organizationSlug}/websites`;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={base}
        >
          Websites
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{website.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <WebsiteStatusBadge status={website.status} />
            <MonitorHealthBadge health={websiteHealth} />
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-3">
            <WebsiteStatusForm
              organizationSlug={organizationSlug}
              websiteId={website.id}
              status={website.status}
            />
            <Link
              className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              href={`${base}/${website.id}/settings`}
            >
              Website settings
            </Link>
          </div>
        ) : null}
      </div>

      <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="font-semibold text-[var(--muted)]">URL</dt>
            <dd className="mt-1 text-base">{website.normalizedUrl}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Overall status
            </dt>
            <dd className="mt-1 text-base">{healthLabel(websiteHealth)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Status</dt>
            <dd className="mt-1 text-base">
              {website.status === "ACTIVE" ? "Active" : "Disabled"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Added</dt>
            <dd className="mt-1 text-base">
              {formatAddedDate(website.createdAt)}
            </dd>
          </div>
        </dl>
        <div className="mt-4">
          <WebsiteDnsNote status={website.dnsStatus} />
        </div>
      </section>

      <WebsiteTrackingSetup
        organizationSlug={organizationSlug}
        websiteId={website.id}
        status={
          tracking?.status === "ENABLED"
            ? "ENABLED"
            : tracking
              ? "DISABLED"
              : "NOT_CONFIGURED"
        }
        siteKey={tracking?.publicSiteKey ?? null}
        lastEventLabel={
          tracking?.lastEventReceivedAt
            ? formatRelativeTime(tracking.lastEventReceivedAt)
            : "No events yet"
        }
        lastAttributionLabel={
          tracking?.lastAttributionReceivedAt
            ? formatRelativeTime(tracking.lastAttributionReceivedAt)
            : "No Google click yet"
        }
        lastLeadLabel={
          tracking?.lastLeadReceivedAt
            ? formatRelativeTime(tracking.lastLeadReceivedAt)
            : "No leads yet"
        }
        snippet={`<script
  defer
  src="${trackingSdkUrl()}"
  data-site-key="${tracking?.publicSiteKey ?? "lg_site_..."}"
></script>`}
        consentSnippet={`LeadGuard.setConsent({ attribution: "granted" })`}
        canManage={canManage}
      />

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Monitoring</h2>
          {canManage ? (
            <Link
              className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
              href={`${base}/${website.id}/monitors/new`}
            >
              Add monitor
            </Link>
          ) : null}
        </div>
        {monitors.length === 0 ? (
          <>
            <p className="mt-4 font-medium">No monitors yet</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Add your first monitor to start checking this website.
            </p>
          </>
        ) : (
          <ul className="mt-5 space-y-4">
            {monitors.map((monitor) => {
              const health = deriveMonitorHealth({
                latestCheck: monitor.latestCheck,
                hasOpenIncident: Boolean(monitor.openIncident),
                receiptStatus:
                  monitor.latestCheck?.leadReceiptVerification?.status,
              });
              return (
                <li
                  className="rounded-xl border border-[var(--border)] p-4"
                  key={monitor.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{monitor.name}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {monitorTypeLabel(monitor.type)}
                      </p>
                      <p className="mt-1 break-all text-sm text-[var(--muted)]">
                        {monitor.normalizedUrl}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {formatInterval(monitor.intervalSeconds)}
                      </p>
                    </div>
                    <MonitorHealthBadge health={health} />
                  </div>
                  {monitor.openIncident ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Open incident ·{" "}
                      {formatDuration(
                        incidentDurationMs(
                          monitor.openIncident.startedAt,
                          null,
                        ),
                      )}
                    </p>
                  ) : monitor.latestCheck ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Last check:{" "}
                      {formatRelativeTime(monitor.latestCheck.finishedAt)}
                      {monitor.latestCheck.responseTimeMs != null
                        ? ` · ${monitor.latestCheck.responseTimeMs} ms`
                        : ""}
                      {monitor.latestCheck.status === "FAILURE"
                        ? ` · ${checkErrorLabel(monitor.latestCheck.errorType, monitor.latestCheck.errorMessage)}`
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Pending first check
                    </p>
                  )}
                  <Link
                    className="mt-3 inline-flex text-sm font-semibold text-[#19d0a2] hover:underline"
                    href={`${base}/${website.id}/monitors/${monitor.id}`}
                  >
                    View monitor
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
