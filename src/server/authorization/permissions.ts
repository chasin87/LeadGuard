import type { OrganizationRole } from "@/generated/prisma/enums";

export const organizationPermissions = {
  "organization:read": ["OWNER", "ADMIN", "MEMBER"],
  "organization:update": ["OWNER"],
  "members:read": ["OWNER", "ADMIN"],
  "members:manage": ["OWNER"],
  "settings:update": ["OWNER"],
  "websites:read": ["OWNER", "ADMIN", "MEMBER"],
  "websites:manage": ["OWNER", "ADMIN"],
  "monitors:read": ["OWNER", "ADMIN", "MEMBER"],
  "monitors:manage": ["OWNER", "ADMIN"],
  "incidents:read": ["OWNER", "ADMIN", "MEMBER"],
  "notifications:read": ["OWNER", "ADMIN", "MEMBER"],
  "notifications:manage": ["OWNER", "ADMIN"],
  "integrations:read": ["OWNER", "ADMIN", "MEMBER"],
  "integrations:manage": ["OWNER", "ADMIN"],
} as const;

export type OrganizationPermission = keyof typeof organizationPermissions;

export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  const allowed = organizationPermissions[permission] as
    readonly OrganizationRole[] | undefined;
  return allowed?.includes(role) ?? false;
}
