import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { database } from "@/server/database";
import { hasOrganizationPermission, type OrganizationPermission, type OrganizationRole } from "@/features/organizations/permissions";
import { authorizeOrganizationMembership } from "@/features/organizations/authorization";

export class OrganizationAccessDeniedError extends Error {
  constructor() { super("ORGANIZATION_ACCESS_DENIED"); }
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function findAuthorizedMembership(userId: string, organizationSlug: string) {
  return database.organizationMember.findFirst({
    where: { userId, organization: { slug: organizationSlug } },
    select: {
      id: true,
      role: true,
      organization: { select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true } },
    },
  });
}

export async function requireOrganizationMembership(organizationSlug: string) {
  const user = await requireUser();
  const membership = await authorizeOrganizationMembership(user.id, organizationSlug, findAuthorizedMembership);
  if (!membership) throw new OrganizationAccessDeniedError();
  return { user, membership, organization: membership.organization };
}

export async function requireOrganizationPermission(organizationSlug: string, permission: OrganizationPermission) {
  const context = await requireOrganizationMembership(organizationSlug);
  if (!hasOrganizationPermission(context.membership.role as OrganizationRole, permission)) throw new OrganizationAccessDeniedError();
  return context;
}

export function isOrganizationAccessDenied(error: unknown): error is OrganizationAccessDeniedError {
  return error instanceof OrganizationAccessDeniedError;
}
