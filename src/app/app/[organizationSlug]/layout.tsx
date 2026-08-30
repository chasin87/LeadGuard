import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { listUserMemberships } from "@/server/auth/service";
import {
  loadOrganizationAccess,
  rememberLastOrganization,
} from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { countOpenIncidents } from "@/server/incidents/service";

export const dynamic = "force-dynamic";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);

  if (access.status === "not_found") {
    notFound();
  }
  if (access.status === "forbidden") {
    return <AccessDenied />;
  }

  await rememberLastOrganization(user.id, access.context.organization.id);
  const [memberships, openIncidentCount] = await Promise.all([
    listUserMemberships(user.id),
    countOpenIncidents(user.id, organizationSlug),
  ]);

  return (
    <AppShell
      organization={access.context.organization}
      role={access.context.membership.role}
      memberships={memberships.map((membership) => ({
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      }))}
      openIncidentCount={openIncidentCount}
    >
      {children}
    </AppShell>
  );
}
