import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { database } from "@/server/database";
import { PlatformConfirmForm } from "@/components/platform-confirm-form";
import { runMonitorNowAction } from "@/server/platform-admin/actions";
import { hasPlatformPermission } from "@/server/platform-admin/permissions";

export const metadata = { title: "Platform monitoring" };

export default async function PlatformMonitoringPage() {
  const actor = await requirePlatformPermission("platform:monitoring:read");
  const canRun = hasPlatformPermission(
    actor.role,
    "platform:monitoring:manage",
  );
  const monitors = await database.monitor.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      type: true,
      url: true,
      status: true,
      lastCheckedAt: true,
      website: {
        select: {
          hostname: true,
          organizationId: true,
          organization: { select: { name: true } },
        },
      },
      incidents: { where: { status: "OPEN" }, select: { id: true }, take: 1 },
    },
  });
  return (
    <div>
      <h1 className="text-2xl font-bold">Monitoring</h1>
      {monitors.length === 0 ? (
        <p className="mt-4 text-[var(--muted)]">No monitors found</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                {[
                  "Organization",
                  "Type",
                  "Target",
                  "Status",
                  "Last check",
                  "Open incident",
                  "Action",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => (
                <tr
                  key={monitor.id}
                  className="border-t border-[var(--border)]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/platform-admin/organizations/${monitor.website.organizationId}`}
                    >
                      {monitor.website.organization.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{monitor.type}</td>
                  <td className="px-3 py-2">{monitor.url}</td>
                  <td className="px-3 py-2">{monitor.status}</td>
                  <td className="px-3 py-2">
                    {monitor.lastCheckedAt?.toISOString() ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {monitor.incidents[0] ? "yes" : "no"}
                  </td>
                  <td className="px-3 py-2">
                    {canRun && monitor.type !== "FORM" ? (
                      <PlatformConfirmForm
                        action={runMonitorNowAction}
                        confirmLabel="Type RUN"
                        confirmValue="RUN"
                        hidden={{
                          monitorId: monitor.id,
                          reason: "platform run now",
                        }}
                        fields={null}
                        submitLabel="Run now"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
