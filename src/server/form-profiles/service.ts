import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";

const logger = createLogger("form-profiles");

export async function listFormTestProfiles(
  userId: string,
  organizationSlug: string,
) {
  const { organization } = await requireOrganizationRole(
    userId,
    organizationSlug,
    "monitors:read",
  );
  return database.formTestProfile.findMany({
    where: { organizationId: organization.id },
    orderBy: { name: "asc" },
  });
}

export async function createFormTestProfile(input: {
  userId: string;
  organizationSlug: string;
  name: string;
  displayName: string;
  email: string;
  phone?: string;
  postcode?: string;
  city?: string;
  company?: string;
  messagePrefix?: string;
  plusAddressing?: boolean;
}) {
  const { organization } = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "monitors:manage",
  );
  try {
    const profile = await database.formTestProfile.create({
      data: {
        organizationId: organization.id,
        name: input.name.trim(),
        displayName: input.displayName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        postcode: input.postcode?.trim() || null,
        city: input.city?.trim() || null,
        company: input.company?.trim() || null,
        messagePrefix: input.messagePrefix?.trim() || null,
        plusAddressing: Boolean(input.plusAddressing),
      },
    });
    logger.info("form.profile.created", {
      organizationId: organization.id,
      userId: input.userId,
    });
    return profile;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DomainError("A test profile with this name already exists.");
    }
    throw error;
  }
}

export async function updateFormTestProfile(input: {
  userId: string;
  organizationSlug: string;
  profileId: string;
  name: string;
  displayName: string;
  email: string;
  phone?: string;
  postcode?: string;
  city?: string;
  company?: string;
  messagePrefix?: string;
  plusAddressing?: boolean;
}) {
  const { organization } = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "monitors:manage",
  );
  const updated = await database.formTestProfile.updateMany({
    where: { id: input.profileId, organizationId: organization.id },
    data: {
      name: input.name.trim(),
      displayName: input.displayName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      postcode: input.postcode?.trim() || null,
      city: input.city?.trim() || null,
      company: input.company?.trim() || null,
      messagePrefix: input.messagePrefix?.trim() || null,
      plusAddressing: Boolean(input.plusAddressing),
    },
  });
  if (updated.count !== 1) {
    throw new DomainError("Test profile not found.");
  }
}

export async function deleteFormTestProfile(input: {
  userId: string;
  organizationSlug: string;
  profileId: string;
}) {
  const { organization } = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "monitors:manage",
  );
  await database.formTestProfile.deleteMany({
    where: { id: input.profileId, organizationId: organization.id },
  });
}
