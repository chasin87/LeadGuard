import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { listPlatformIntegrations } from "@/server/platform-admin/queries";

export const metadata = { title: "Platform integrations" };

export default async function PlatformIntegrationsPage() {
  await requirePlatformPermission("platform:integrations:read");
  const data = await listPlatformIntegrations();
  return (
    <div>
      <h1 className="text-2xl font-bold">Integrations</h1>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Google Ads</h2>
        {data.google.length === 0 ? (
          <p className="mt-2 text-[var(--muted)]">No Google connections</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.google.map((row) => (
              <li key={row.organizationId}>
                <Link
                  href={`/platform-admin/organizations/${row.organizationId}?tab=integrations`}
                >
                  {row.organization.name}
                </Link>{" "}
                · {row.status} · Data Manager {row.dataManagerStatus}
                {row.status === "REAUTH_REQUIRED"
                  ? " · Customer reauthorization required"
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">
          Organizations with unmatched outcome events
        </h2>
        {data.unmatched.length === 0 ? (
          <p className="mt-2 text-[var(--muted)]">No unmatched events</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.unmatched.map((row) => (
              <li key={row.organizationId}>
                <Link
                  href={`/platform-admin/organizations/${row.organizationId}?tab=integrations`}
                >
                  {row.organizationId}
                </Link>{" "}
                · {row._count._all}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Conversion feedback issues</h2>
        {data.conversion.length === 0 ? (
          <p className="mt-2 text-[var(--muted)]">No conversion issues</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.conversion.map((row) => (
              <li key={`${row.organizationId}-${row.status}`}>
                {row.status}: {row._count._all}{" "}
                <Link
                  href={`/platform-admin/organizations/${row.organizationId}?tab=integrations`}
                >
                  org
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
