import Link from "next/link";
import { WebsiteStatusBadge } from "@/components/website-status-badge";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { listWebsites } from "@/server/websites/service";

export const metadata = { title: "Websites" };

export default async function WebsitesPage({
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

  const websites = await listWebsites(user.id, organizationSlug);
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "websites:manage",
  );
  const base = `/app/${organizationSlug}/websites`;

  return (
    <div className="px-5 py-10 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Websites</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted)]">
            Monitoring checks are configured per page. Overall status comes from
            monitors and open incidents.
          </p>
        </div>
        {canManage ? (
          <Link
            className="rounded-xl bg-[#19d0a2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#193f36]"
            href={`${base}/new`}
          >
            Add website
          </Link>
        ) : null}
      </div>

      {websites.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-8">
          <h2 className="text-xl font-bold">No websites yet</h2>
          <p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">
            Add the first website you want LeadGuard to protect.
          </p>
          {canManage ? (
            <Link
              className="mt-6 inline-flex rounded-xl bg-[#19d0a2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#193f36]"
              href={`${base}/new`}
            >
              Add website
            </Link>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">
              Ask an owner or admin to add a website.
            </p>
          )}
        </section>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {websites.map((website) => (
            <li
              className="rounded-2xl border border-[var(--border)] bg-white p-5"
              key={website.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{website.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {website.hostname}
                  </p>
                </div>
                <WebsiteStatusBadge status={website.status} />
              </div>
              <Link
                className="mt-5 inline-flex text-sm font-semibold text-[#19d0a2] hover:underline"
                href={`${base}/${website.id}`}
              >
                View website
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
