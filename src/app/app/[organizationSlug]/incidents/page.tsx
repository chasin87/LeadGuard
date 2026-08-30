import Link from "next/link";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { requireUser } from "@/server/authorization/session";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import {
  listOrganizationIncidents,
  type IncidentListFilter,
} from "@/server/incidents/service";
import { checkIncidentHeadline } from "@/lib/monitoring/display";
import { formatDuration, incidentDurationMs } from "@/lib/incidents/duration";
import {
  compactImpactLine,
  presentGoogleAdsImpact,
} from "@/server/google-ads/impact/presentation";

export const metadata = { title: "Incidents" };

function parseFilter(value: string | string[] | undefined): IncidentListFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "resolved" || raw === "all") return raw;
  return "open";
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
        active
          ? "bg-[#19d0a2] text-white"
          : "border border-[var(--border)] bg-white hover:bg-slate-50"
      }`}
      href={href}
    >
      {children}
    </Link>
  );
}

export default async function IncidentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationSlug } = await params;
  const query = await searchParams;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;

  const filter = parseFilter(query.status);
  const incidents = await listOrganizationIncidents(
    user.id,
    organizationSlug,
    filter,
  );
  const base = `/app/${organizationSlug}/incidents`;
  const open = incidents.filter((incident) => incident.status === "OPEN");
  const resolved = incidents.filter(
    (incident) => incident.status === "RESOLVED",
  );
  const sections =
    filter === "open"
      ? [{ title: "Open incidents", items: open }]
      : filter === "resolved"
        ? [{ title: "Resolved incidents", items: resolved }]
        : [
            { title: "Open incidents", items: open },
            { title: "Resolved incidents", items: resolved },
          ];

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Incidents</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        An incident is a streak of failed checks, not a single measurement.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <FilterLink href={base} active={filter === "open"}>
          Open
        </FilterLink>
        <FilterLink
          href={`${base}?status=resolved`}
          active={filter === "resolved"}
        >
          Resolved
        </FilterLink>
        <FilterLink href={`${base}?status=all`} active={filter === "all"}>
          All
        </FilterLink>
      </div>

      {sections.map((section) => (
        <section
          className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6"
          key={section.title}
        >
          <h2 className="text-lg font-bold">{section.title}</h2>
          {section.items.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">None.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {section.items.map((incident) => (
                <li key={incident.id}>
                  <Link
                    className="block rounded-xl border border-[var(--border)] p-4 hover:bg-slate-50"
                    href={`${base}/${incident.id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{incident.monitor.name}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {incident.monitor.website.hostname}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {checkIncidentHeadline(
                            incident.latestErrorType,
                            null,
                          )}
                          {incident.googleAdsIncidentImpact
                            ? compactImpactSuffix(
                                incident.googleAdsIncidentImpact,
                              )
                            : ""}
                        </p>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          Started{" "}
                          {incident.startedAt.toISOString().slice(11, 16)} UTC
                          {" · "}
                          Detected{" "}
                          {incident.detectedAt.toISOString().slice(11, 16)} UTC
                          {" · "}
                          Duration{" "}
                          {formatDuration(
                            incidentDurationMs(
                              incident.startedAt,
                              incident.resolvedAt,
                            ),
                          )}
                        </p>
                      </div>
                      <IncidentStatusBadge status={incident.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function compactImpactSuffix(impact: {
  status: "PENDING" | "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR";
  windowCostMicros: bigint | null;
  currencyCode: string;
  windowClicksEstimated: boolean;
  attributionMethod:
    | "SOURCE_HOURLY"
    | "SOURCE_HOURLY_PRORATED"
    | "DESTINATION_REPORTED_DAILY"
    | "MIXED"
    | "UNAVAILABLE";
}) {
  const line = compactImpactLine(
    presentGoogleAdsImpact({
      status: impact.status,
      attributionMethod: impact.attributionMethod,
      confidence: "MEDIUM",
      isProvisional: false,
      dataIncomplete: false,
      currencyCode: impact.currencyCode,
      windowCostMicros: impact.windowCostMicros,
      windowClicksMilli: null,
      windowClicksEstimated: impact.windowClicksEstimated,
      destinationDailyCostMicros: null,
      destinationDailyFrom: null,
      destinationDailyTo: null,
      totalRelevantSources: 0,
      attributedSources: 0,
      lastRefreshedAt: null,
      dataThrough: null,
      diagnosticCode: null,
    }),
  );
  return line ? ` · ${line}` : "";
}
