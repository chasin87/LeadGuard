import { redirect } from "next/navigation";
import { requireUser } from "@/server/authorization";
import { listOrganizationsForUser } from "@/server/organizations/service";

export default async function LegacyDashboardRedirect() {
  const user = await requireUser();
  const memberships = await listOrganizationsForUser(user.id);
  redirect(memberships[0] ? `/app/${memberships[0].organization.slug}/dashboard` : "/onboarding");
}
