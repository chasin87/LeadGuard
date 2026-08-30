import { database } from "@/server/database";
import { createUserAccount } from "@/server/auth/service";
import { createOrganizationWithOwner } from "@/server/organizations/service";
import type { PublicUser } from "@/server/authorization/organization";
import type { OrganizationSummary } from "@/server/authorization/organization";

export const testPassword = "CorrectHorse1";

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function createTestUser(name = "Test User"): Promise<PublicUser> {
  return createUserAccount({
    name,
    email: uniqueEmail(name.toLowerCase().replace(/\s+/g, ".")),
    password: testPassword,
  });
}

export async function createTestOwner(name = "Owner"): Promise<{
  user: PublicUser;
  organization: OrganizationSummary;
}> {
  const user = await createTestUser(name);
  const organization = await createOrganizationWithOwner({
    userId: user.id,
    name: `${name} Org ${Date.now()}`,
  });
  return { user, organization };
}

export async function deleteTestData(params: {
  userIds?: string[];
  organizationIds?: string[];
}): Promise<void> {
  if (params.organizationIds?.length) {
    await database.organization.deleteMany({
      where: { id: { in: params.organizationIds } },
    });
  }
  if (params.userIds?.length) {
    await database.user.deleteMany({
      where: { id: { in: params.userIds } },
    });
  }
}
