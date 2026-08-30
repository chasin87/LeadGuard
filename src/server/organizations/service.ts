import "server-only";
import { database } from "@/server/database";
import { registrationSchema, type RegistrationInput } from "@/features/auth/schemas";
import { createOrganizationSchema, updateOrganizationSchema } from "@/features/organizations/schemas";
import { slugCandidate, slugifyOrganizationName } from "@/features/organizations/slug";
import { hashPassword } from "@/server/auth/password";

const MAX_SLUG_ATTEMPTS = 25;

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function availableSlug(name: string): Promise<string> {
  const base = slugifyOrganizationName(name);
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = slugCandidate(base, attempt);
    if (!(await database.organization.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base.slice(0, 59)}-${crypto.randomUUID().slice(0, 12)}`;
}

export async function registerWithOrganization(rawInput: RegistrationInput) {
  const input = registrationSchema.parse(rawInput);
  const passwordHash = await hashPassword(input.password);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await availableSlug(input.organizationName);
    try {
      return await database.$transaction(async (transaction) => {
        const user = await transaction.user.create({ data: { name: input.name, email: input.email, passwordHash }, select: { id: true, name: true, email: true } });
        const organization = await transaction.organization.create({ data: { name: input.organizationName, slug } });
        await transaction.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
        return { user, organization };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error;
    }
  }
  throw new Error("REGISTRATION_FAILED");
}

export async function createOrganizationForUser(userId: string, rawInput: unknown) {
  const input = createOrganizationSchema.parse(rawInput);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await availableSlug(input.name);
    try {
      return await database.$transaction(async (transaction) => {
        const organization = await transaction.organization.create({ data: { name: input.name, slug } });
        await transaction.organizationMember.create({ data: { userId, organizationId: organization.id, role: "OWNER" } });
        return organization;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error;
    }
  }
  throw new Error("ORGANIZATION_CREATION_FAILED");
}

export async function listOrganizationsForUser(userId: string) {
  return database.organizationMember.findMany({
    where: { userId },
    select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { organization: { name: "asc" } },
  });
}

export async function updateOrganizationNameForUser(userId: string, organizationSlug: string, rawInput: unknown) {
  const input = updateOrganizationSchema.parse(rawInput);
  return database.$transaction(async (transaction) => {
    const membership = await transaction.organizationMember.findFirst({
      where: { userId, role: "OWNER", organization: { slug: organizationSlug } },
      select: { organizationId: true },
    });
    if (!membership) throw new Error("ORGANIZATION_ACCESS_DENIED");
    return transaction.organization.update({ where: { id: membership.organizationId }, data: { name: input.name } });
  });
}
