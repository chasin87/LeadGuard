export const organizationRoles = ["OWNER", "ADMIN", "MEMBER"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export type OrganizationPermission = "organization:view" | "organization:update" | "members:view" | "members:manage";

const permissions: Record<OrganizationRole, ReadonlySet<OrganizationPermission>> = {
  OWNER: new Set(["organization:view", "organization:update", "members:view", "members:manage"]),
  ADMIN: new Set(["organization:view", "members:view"]),
  MEMBER: new Set(["organization:view"]),
};

export function hasOrganizationPermission(role: OrganizationRole, permission: OrganizationPermission): boolean {
  return permissions[role].has(permission);
}

export function assertOwnerChangeAllowed(input: { currentOwnerCount: number; subjectRole: OrganizationRole; nextRole?: OrganizationRole }): void {
  const removesOwner = input.subjectRole === "OWNER" && input.nextRole !== "OWNER";
  if (removesOwner && input.currentOwnerCount <= 1) throw new Error("LAST_OWNER_PROTECTED");
}
