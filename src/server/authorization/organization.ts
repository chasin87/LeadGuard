import "server-only";

import { cache } from "react";
import type { OrganizationRole } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import {
  AuthorizationError,
  OrganizationNotFoundError,
} from "@/server/authorization/errors";
import {
  hasOrganizationPermission,
  type OrganizationPermission,
} from "@/server/authorization/permissions";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: Date | null;
  lastUsedOrganizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  defaultRevenueCurrencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationContext = {
  user: PublicUser;
  organization: OrganizationSummary;
  membership: {
    id: string;
    role: OrganizationRole;
    createdAt: Date;
    updatedAt: Date;
  };
};

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  lastUsedOrganizationId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function getPublicUserById(
  userId: string,
): Promise<PublicUser | null> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      status: true,
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    lastUsedOrganizationId: user.lastUsedOrganizationId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function getActiveSessionUser(
  userId: string,
): Promise<PublicUser | null> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      status: true,
      sessionInvalidatedAt: true,
      lastLoginAt: true,
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (
    user.sessionInvalidatedAt &&
    (!user.lastLoginAt ||
      user.lastLoginAt.getTime() <= user.sessionInvalidatedAt.getTime())
  ) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    lastUsedOrganizationId: user.lastUsedOrganizationId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export type OrganizationAccess =
  | { status: "ok"; context: OrganizationContext }
  | { status: "not_found" }
  | { status: "forbidden" };

export const loadOrganizationAccess = cache(
  async (
    userId: string,
    organizationSlug: string,
  ): Promise<OrganizationAccess> => {
    try {
      const context = await requireOrganizationMembership(
        userId,
        organizationSlug,
      );
      return { status: "ok", context };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return { status: "not_found" };
      }
      if (error instanceof AuthorizationError) {
        return { status: "forbidden" };
      }
      throw error;
    }
  },
);

export async function requireOrganizationMembership(
  userId: string,
  organizationSlug: string,
): Promise<OrganizationContext> {
  const organization = await database.organization.findUnique({
    where: { slug: organizationSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      defaultRevenueCurrencyCode: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!organization) {
    throw new OrganizationNotFoundError();
  }

  return requireOrganizationMembershipById(userId, organization);
}

export async function requireOrganizationMembershipById(
  userId: string,
  organization: OrganizationSummary,
): Promise<OrganizationContext> {
  const [user, membership] = await Promise.all([
    getPublicUserById(userId),
    database.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: organization.id,
        },
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!user || !membership) {
    throw new AuthorizationError();
  }

  return { user, organization, membership };
}

export async function requireOrganizationRole(
  userId: string,
  organizationSlug: string,
  permission: OrganizationPermission,
): Promise<OrganizationContext> {
  const context = await requireOrganizationMembership(userId, organizationSlug);
  if (!hasOrganizationPermission(context.membership.role, permission)) {
    throw new AuthorizationError(
      "Je hebt onvoldoende rechten voor deze actie.",
    );
  }
  return context;
}

export async function requireOrganizationOwner(
  userId: string,
  organizationSlug: string,
): Promise<OrganizationContext> {
  return requireOrganizationRole(userId, organizationSlug, "settings:update");
}

export async function rememberLastOrganization(
  userId: string,
  organizationId: string,
): Promise<void> {
  await database.user.update({
    where: { id: userId },
    data: { lastUsedOrganizationId: organizationId },
  });
}
