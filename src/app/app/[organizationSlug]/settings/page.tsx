import Link from "next/link";
import { OrganizationSettingsForm } from "@/components/organization-settings-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";

export const metadata = { title: "Instellingen" };

export default async function OrganizationSettingsPage({
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
  const canEdit = hasOrganizationPermission(
    context.membership.role,
    "organization:update",
  );
  const canReadMembers = hasOrganizationPermission(
    context.membership.role,
    "members:read",
  );

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Instellingen</h1>
      <p className="mt-2 text-[var(--muted)]">
        Organisatiegegevens en toegang.
      </p>
      <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Organisatiegegevens</h2>
        <div className="mt-5">
          <OrganizationSettingsForm
            organizationSlug={context.organization.slug}
            name={context.organization.name}
            slug={context.organization.slug}
            role={context.membership.role}
            canEdit={canEdit}
          />
        </div>
      </section>
      {canReadMembers ? (
        <p className="mt-6">
          <Link
            className="font-semibold text-[#19d0a2] hover:underline"
            href={`/app/${context.organization.slug}/settings/members`}
          >
            Leden bekijken
          </Link>
        </p>
      ) : null}
      <p className="mt-3">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${context.organization.slug}/integrations/google-ads`}
        >
          Integrations
        </Link>
      </p>
      <p className="mt-3">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${context.organization.slug}/settings/notifications`}
        >
          Notifications
        </Link>
      </p>
    </div>
  );
}
