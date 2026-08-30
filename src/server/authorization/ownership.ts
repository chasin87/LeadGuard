import "server-only";
import { database } from "@/server/database";
import { assertOwnerChangeAllowed, type OrganizationRole } from "@/features/organizations/permissions";

export async function assertMembershipMutationPreservesOwner(organizationId: string, subjectRole: OrganizationRole, nextRole?: OrganizationRole) {
  if (subjectRole !== "OWNER" || nextRole === "OWNER") return;
  const currentOwnerCount = await database.organizationMember.count({ where: { organizationId, role: "OWNER" } });
  assertOwnerChangeAllowed({ currentOwnerCount, subjectRole, nextRole });
}
