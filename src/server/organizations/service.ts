import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { OrganizationRole } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import {
  requireOrganizationMembership,
  requireOrganizationMembershipById,
  requireOrganizationRole,
  type OrganizationContext,
  type OrganizationSummary,
} from "@/server/authorization/organization";
import { assertOrganizationKeepsOwner } from "@/server/authorization/ownership";
import {
  nextSlugCandidate,
  randomSlugSuffix,
  slugifyOrganizationName,
} from "@/server/organizations/slug";
import { startOrganizationTrial } from "@/server/billing/service";

export async function allocateUniqueSlug(
  name: string,
  client: Pick<typeof database, "organization"> = database,
): Promise<string> {
  const base = slugifyOrganizationName(name);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = nextSlugCandidate(base, attempt);
    const existing = await client.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomSlugSuffix(base);
    const existing = await client.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  throw new DomainError(
    "Kon geen unieke organisatielink maken. Probeer een andere naam.",
  );
}

export async function createOrganizationWithOwner(input: {
  userId: string;
  name: string;
}): Promise<OrganizationSummary> {
  const name = input.name.trim();

  try {
    const created = await database.$transaction(async (tx) => {
      const slug = await allocateUniqueSlug(name, tx);
      const organization = await tx.organization.create({
        data: {
          name,
          slug,
          members: {
            create: {
              userId: input.userId,
              role: "OWNER",
            },
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          defaultRevenueCurrencyCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.user.update({
        where: { id: input.userId },
        data: { lastUsedOrganizationId: organization.id },
      });

      return organization;
    });
    await startOrganizationTrial({
      organizationId: created.id,
      ownerUserId: input.userId,
    });
    return created;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DomainError(
        "Deze organisatie kon niet worden aangemaakt. Probeer het opnieuw.",
      );
    }
    throw error;
  }
}

export async function updateOrganizationName(
  userId: string,
  organizationSlug: string,
  name: string,
): Promise<OrganizationSummary> {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "organization:update",
  );

  return database.organization.update({
    where: { id: context.organization.id },
    data: { name: name.trim() },
    select: {
      id: true,
      name: true,
      slug: true,
      defaultRevenueCurrencyCode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateOrganizationSettings(
  userId: string,
  organizationSlug: string,
  input: { name: string; defaultRevenueCurrencyCode: string | null },
): Promise<OrganizationSummary> {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "organization:update",
  );

  return database.organization.update({
    where: { id: context.organization.id },
    data: {
      name: input.name.trim(),
      defaultRevenueCurrencyCode: input.defaultRevenueCurrencyCode,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      defaultRevenueCurrencyCode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getOrganizationForMember(
  userId: string,
  organizationSlug: string,
): Promise<OrganizationContext> {
  return requireOrganizationMembership(userId, organizationSlug);
}

export async function getOrganizationByIdForMember(
  userId: string,
  organizationId: string,
): Promise<OrganizationContext> {
  const organization = await database.organization.findUnique({
    where: { id: organizationId },
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
    throw new AuthorizationError();
  }

  return requireOrganizationMembershipById(userId, organization);
}

export type OrganizationMemberView = {
  id: string;
  role: OrganizationRole;
  createdAt: Date;
  user: { id: string; name: string; email: string };
};

export async function listOrganizationMembers(
  userId: string,
  organizationSlug: string,
): Promise<OrganizationMemberView[]> {
  const context = await requireOrganizationRole(
    userId,
    organizationSlug,
    "members:read",
  );

  return database.organizationMember.findMany({
    where: { organizationId: context.organization.id },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function changeOrganizationMemberRole(input: {
  actorUserId: string;
  organizationSlug: string;
  memberId: string;
  role: OrganizationRole;
}): Promise<OrganizationMemberView> {
  const context = await requireOrganizationRole(
    input.actorUserId,
    input.organizationSlug,
    "members:manage",
  );

  return database.$transaction(async (tx) => {
    const member = await tx.organizationMember.findFirst({
      where: {
        id: input.memberId,
        organizationId: context.organization.id,
      },
    });

    if (!member) {
      throw new AuthorizationError("Dit lid hoort niet bij deze organisatie.");
    }

    await assertOrganizationKeepsOwner({
      client: tx,
      organizationId: context.organization.id,
      currentRole: member.role,
      nextRole: input.role,
    });

    return tx.organizationMember.update({
      where: { id: member.id },
      data: { role: input.role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  });
}

export async function removeOrganizationMember(input: {
  actorUserId: string;
  organizationSlug: string;
  memberId: string;
}): Promise<void> {
  const context = await requireOrganizationRole(
    input.actorUserId,
    input.organizationSlug,
    "members:manage",
  );

  await database.$transaction(async (tx) => {
    const member = await tx.organizationMember.findFirst({
      where: {
        id: input.memberId,
        organizationId: context.organization.id,
      },
    });

    if (!member) {
      throw new AuthorizationError("Dit lid hoort niet bij deze organisatie.");
    }

    await assertOrganizationKeepsOwner({
      client: tx,
      organizationId: context.organization.id,
      currentRole: member.role,
      nextRole: null,
    });

    await tx.organizationMember.delete({ where: { id: member.id } });
  });
}
