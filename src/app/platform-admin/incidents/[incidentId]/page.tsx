import Link from "next/link";
import { notFound } from "next/navigation";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { getPlatformIncident } from "@/server/platform-admin/queries";

export const metadata = { title: "Incident" };

export default async function PlatformIncidentDetailPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  await requirePlatformPermission("platform:monitoring:read");
  const { incidentId } = await params;
  const incident = await getPlatformIncident(incidentId);
  if (!incident) notFound();
  return (
    <div>
      <p className="text-sm">
        <Link href="/platform-admin/incidents">Incidents</Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">{incident.monitor.name}</h1>
      <IncidentStatusBadge status={incident.status} />
      <section className="mt-4 space-y-1 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <p>Organization: {incident.monitor.website.organization.name}</p>
        <p>Website: {incident.monitor.website.hostname}</p>
        <p>Failure: {incident.latestErrorType ?? incident.initialErrorType}</p>
        <p>Opened: {incident.detectedAt.toISOString()}</p>
        <p className="text-[var(--muted)]">
          Incidents are resolved by the Incident Engine, not by platform admin.
        </p>
      </section>
      <h2 className="mt-6 font-semibold">Recent checks</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {incident.monitor.checks.map((check) => (
          <li key={check.id}>
            {check.createdAt.toISOString()} · {check.status} ·{" "}
            {check.errorType ?? "ok"} · HTTP {check.httpStatus ?? "—"}
          </li>
        ))}
      </ul>
    </div>
  );
}
