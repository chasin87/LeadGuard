import Link from "next/link";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { listPlatformIncidents } from "@/server/platform-admin/queries";
import type { IncidentStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Platform incidents" };

export default async function PlatformIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform:monitoring:read");
  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const result = await listPlatformIncidents({
    status: (read("status") ?? "OPEN") as IncidentStatus | "",
    organizationId: read("organizationId"),
    type: read("type"),
    cursor: read("cursor"),
  });
  return (
    <div>
      <h1 className="text-2xl font-bold">Incidents</h1>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <select
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="status"
          defaultValue={read("status") ?? "OPEN"}
        >
          <option value="OPEN">OPEN</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="">All</option>
        </select>
        <input
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="organizationId"
          placeholder="Organization ID"
          defaultValue={read("organizationId") ?? ""}
        />
        <input
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="type"
          placeholder="Failure type"
          defaultValue={read("type") ?? ""}
        />
        <button
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Filter
        </button>
      </form>
      {result.rows.length === 0 ? (
        <p className="mt-6 text-[var(--muted)]">No open incidents</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                {[
                  "Organization",
                  "Website",
                  "Monitor",
                  "State",
                  "Failure type",
                  "Opened",
                  "Age",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((incident) => (
                <tr
                  key={incident.id}
                  className="border-t border-[var(--border)]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/platform-admin/organizations/${incident.monitor.website.organization.id}`}
                    >
                      {incident.monitor.website.organization.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {incident.monitor.website.hostname}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/platform-admin/incidents/${incident.id}`}>
                      {incident.monitor.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <IncidentStatusBadge status={incident.status} />
                  </td>
                  <td className="px-3 py-2">
                    {incident.latestErrorType ??
                      incident.initialErrorType ??
                      "—"}
                  </td>
                  <td className="px-3 py-2">
                    {incident.detectedAt.toISOString()}
                  </td>
                  <td className="px-3 py-2">{incident.ageHours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
