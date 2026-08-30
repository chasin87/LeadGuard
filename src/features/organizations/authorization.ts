import type { OrganizationRole } from "./permissions";

export type MembershipContext = {
  id: string;
  role: OrganizationRole;
  organization: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date };
};

export async function authorizeOrganizationMembership(
  userId: string,
  organizationSlug: string,
  lookup: (userId: string, organizationSlug: string) => Promise<MembershipContext | null>,
): Promise<MembershipContext | null> {
  if (!userId || !organizationSlug) return null;
  return lookup(userId, organizationSlug);
}
