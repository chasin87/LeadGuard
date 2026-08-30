import { updateOrganizationAction } from "@/app/actions/organizations";
import { OrganizationForm } from "@/components/organization-form";
import { requireOrganizationMembership } from "@/server/authorization";
import { hasOrganizationPermission, type OrganizationRole } from "@/features/organizations/permissions";

export const metadata = { title: "Organisatie-instellingen" };

export default async function SettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const { organization, membership } = await requireOrganizationMembership(organizationSlug);
  const canUpdate = hasOrganizationPermission(membership.role as OrganizationRole, "organization:update");
  const action = updateOrganizationAction.bind(null, organizationSlug);
  return <><p className="text-sm font-semibold text-[#235347]">Instellingen</p><h1 className="mt-1 text-3xl font-bold">Organisatie</h1><section className="mt-7 rounded-2xl border border-[var(--border)] bg-white p-7"><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-[var(--muted)]">Slug</dt><dd className="mt-1 font-mono text-sm">{organization.slug}</dd></div><div><dt className="text-sm text-[var(--muted)]">Jouw rol</dt><dd className="mt-1 font-semibold">{membership.role}</dd></div></dl>{canUpdate ? <OrganizationForm action={action} defaultName={organization.name} submitLabel="Naam opslaan" /> : <div className="mt-6"><p className="text-sm text-[var(--muted)]">Alleen een OWNER kan de organisatienaam wijzigen.</p><p className="mt-2 font-semibold">{organization.name}</p></div>}</section></>;
}
