import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isOrganizationAccessDenied, requireOrganizationMembership } from "@/server/authorization";
import { listOrganizationsForUser } from "@/server/organizations/service";

export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  try {
    const context = await requireOrganizationMembership(organizationSlug);
    const memberships = await listOrganizationsForUser(context.user.id);
    return <AppShell active={{ role: context.membership.role, organization: context.organization }} memberships={memberships}>{children}</AppShell>;
  } catch (error) {
    if (isOrganizationAccessDenied(error)) notFound();
    throw error;
  }
}
