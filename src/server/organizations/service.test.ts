import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { allocateUniqueSlug, createOrganizationWithOwner } from "./service";

const userIds: string[] = [];
const organizationIds: string[] = [];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

describe("organization creation", () => {
  it("makes the creator OWNER inside a single transaction", async () => {
    const user = await createTestUser("Creator");
    userIds.push(user.id);
    const organization = await createOrganizationWithOwner({
      userId: user.id,
      name: "Voltios Energie",
    });
    organizationIds.push(organization.id);

    const membership = await database.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: organization.id,
        },
      },
    });

    expect(organization.slug).toMatch(/^voltios-energie/);
    expect(membership?.role).toBe("OWNER");
  });

  it("allows one user to own multiple organizations", async () => {
    const user = await createTestUser("Multi");
    userIds.push(user.id);
    const first = await createOrganizationWithOwner({
      userId: user.id,
      name: "Voltios Energie",
    });
    const second = await createOrganizationWithOwner({
      userId: user.id,
      name: "Laadpaaltje.com",
    });
    organizationIds.push(first.id, second.id);

    const memberships = await database.organizationMember.findMany({
      where: { userId: user.id },
    });
    expect(memberships).toHaveLength(2);
    expect(memberships.every((membership) => membership.role === "OWNER")).toBe(
      true,
    );
  });

  it("handles slug collisions by appending a suffix", async () => {
    const { user, organization } = await createTestOwner("Slug Owner");
    userIds.push(user.id);
    organizationIds.push(organization.id);

    const colliding = await createOrganizationWithOwner({
      userId: user.id,
      name: organization.name,
    });
    organizationIds.push(colliding.id);

    expect(colliding.slug).not.toBe(organization.slug);
    expect(colliding.slug.startsWith(organization.slug)).toBe(true);
  });

  it("allocates a unique slug when the base already exists", async () => {
    const { user, organization } = await createTestOwner("Unique Slug");
    userIds.push(user.id);
    organizationIds.push(organization.id);
    const next = await allocateUniqueSlug(organization.name);
    expect(next).not.toBe(organization.slug);
  });
});
