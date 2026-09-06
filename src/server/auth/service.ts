import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { OrganizationRole } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { hashPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/email";
import { DomainError } from "@/server/authorization/errors";
import type { PublicUser } from "@/server/authorization/organization";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  lastUsedOrganizationId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createUserAccount(input: {
  name: string;
  email: string;
  password: string;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    return await database.user.create({
      data: {
        name: input.name.trim(),
        email,
        passwordHash,
      },
      select: publicUserSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DomainError("Dit e-mailadres is al in gebruik.");
    }
    throw error;
  }
}

export async function findUserForCredentials(email: string): Promise<{
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  status: "ACTIVE" | "DISABLED";
} | null> {
  return database.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      status: true,
    },
  });
}

export async function listUserMemberships(userId: string): Promise<
  Array<{
    role: OrganizationRole;
    organization: { id: string; name: string; slug: string };
  }>
> {
  return database.organizationMember.findMany({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function resolvePostLoginPathByEmail(
  email: string,
): Promise<string> {
  const user = await findUserForCredentials(email);
  if (!user) return "/app";
  return resolvePostLoginPath(user.id);
}

export async function resolvePostLoginPath(userId: string): Promise<string> {
  const [user, memberships] = await Promise.all([
    database.user.findUnique({
      where: { id: userId },
      select: { lastUsedOrganizationId: true },
    }),
    listUserMemberships(userId),
  ]);

  if (memberships.length === 0) {
    return "/onboarding";
  }

  const lastUsed = memberships.find(
    (membership) => membership.organization.id === user?.lastUsedOrganizationId,
  );
  if (lastUsed) {
    return `/app/${lastUsed.organization.slug}/dashboard`;
  }

  if (memberships.length === 1) {
    const only = memberships[0];
    if (!only) return "/app";
    return `/app/${only.organization.slug}/dashboard`;
  }

  return "/app";
}
