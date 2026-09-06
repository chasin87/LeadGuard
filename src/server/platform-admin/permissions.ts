import type { PlatformRole } from "@/generated/prisma/enums";

export const platformPermissions = {
  "platform:overview": ["SUPER_ADMIN", "SUPPORT"],
  "platform:organizations:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:organizations:manage": ["SUPER_ADMIN"],
  "platform:users:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:users:manage": ["SUPER_ADMIN"],
  "platform:billing:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:billing:manage": ["SUPER_ADMIN"],
  "platform:monitoring:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:monitoring:manage": ["SUPER_ADMIN", "SUPPORT"],
  "platform:integrations:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:integrations:manage": ["SUPER_ADMIN"],
  "platform:operations:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:operations:manage": ["SUPER_ADMIN", "SUPPORT"],
  "platform:audit:read": ["SUPER_ADMIN", "SUPPORT"],
  "platform:revenue:read": ["SUPER_ADMIN"],
  "platform:revenue:summary": ["SUPER_ADMIN", "SUPPORT"],
  "platform:roles:manage": ["SUPER_ADMIN"],
} as const;

export type PlatformPermission = keyof typeof platformPermissions;

export function hasPlatformPermission(
  role: PlatformRole,
  permission: PlatformPermission,
): boolean {
  const allowed = platformPermissions[permission] as
    readonly PlatformRole[] | undefined;
  return allowed?.includes(role) ?? false;
}

export const platformAuditActions = [
  "PLATFORM_ROLE_GRANTED",
  "PLATFORM_ROLE_REVOKED",
  "USER_DISABLED",
  "USER_REACTIVATED",
  "ORGANIZATION_SUSPENDED",
  "ORGANIZATION_REACTIVATED",
  "ENTITLEMENT_OVERRIDE_CREATED",
  "ENTITLEMENT_OVERRIDE_UPDATED",
  "ENTITLEMENT_OVERRIDE_REMOVED",
  "BILLING_RECONCILIATION_TRIGGERED",
  "MONITOR_RUN_TRIGGERED",
  "JOB_RETRY_TRIGGERED",
] as const;

export type PlatformAuditAction = (typeof platformAuditActions)[number];
