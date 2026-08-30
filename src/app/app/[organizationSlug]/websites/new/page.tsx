import Link from "next/link";
import { WebsiteCreateForm } from "@/components/website-create-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";

export const metadata = { title: "Add website" };

export default async function NewWebsitePage({
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

  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "websites:manage",
  );

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/websites`}
        >
          Websites
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Add website</h1>
      {canManage ? (
        <>
          <p className="mt-2 max-w-xl text-[var(--muted)]">
            Add the public website origin. Specific pages will become monitors
            later.
          </p>
          <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
            <WebsiteCreateForm organizationSlug={organizationSlug} />
          </section>
        </>
      ) : (
        <p className="mt-4 max-w-xl text-[var(--muted)]">
          Only owners and admins can add websites.
        </p>
      )}
    </div>
  );
}
