import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import {
  requireOrganizationMembership,
  requireOrganizationOwner,
  requireOrganizationRole,
} from "@/server/authorization/organization";
import {
  changeOrganizationMemberRole,
  getOrganizationByIdForMember,
  getOrganizationForMember,
  listOrganizationMembers,
  removeOrganizationMember,
  updateOrganizationName,
} from "@/server/organizations/service";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";

const userIds: string[] = [];
const organizationIds: string[] = [];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

describe("authorization and cross-tenant isolation", () => {
  it("lets a member read their own organization", async () => {
    const { user, organization } = await createTestOwner("Own Org");
    userIds.push(user.id);
    organizationIds.push(organization.id);

    const context = await getOrganizationForMember(user.id, organization.slug);
    expect(context.organization.id).toBe(organization.id);
    expect(context.membership.role).toBe("OWNER");
  });

  it("blocks an outsider from reading or changing another organization", async () => {
    const tenantA = await createTestOwner("Tenant A");
    const tenantB = await createTestOwner("Tenant B");
    userIds.push(tenantA.user.id, tenantB.user.id);
    organizationIds.push(tenantA.organization.id, tenantB.organization.id);

    await expect(
      getOrganizationForMember(tenantA.user.id, tenantB.organization.slug),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      getOrganizationByIdForMember(tenantA.user.id, tenantB.organization.id),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      updateOrganizationName(
        tenantA.user.id,
        tenantB.organization.slug,
        "Hacked",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      listOrganizationMembers(tenantA.user.id, tenantB.organization.slug),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      requireOrganizationMembership(tenantA.user.id, tenantB.organization.slug),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const unchanged = await database.organization.findUnique({
      where: { id: tenantB.organization.id },
    });
    expect(unchanged?.name).toBe(tenantB.organization.name);
  });

  it("gives MEMBER no owner or admin rights", async () => {
    const owner = await createTestOwner("Member Rights");
    const member = await createTestUser("Plain Member");
    userIds.push(owner.user.id, member.id);
    organizationIds.push(owner.organization.id);

    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });

    await expect(
      requireOrganizationMembership(member.id, owner.organization.slug),
    ).resolves.toMatchObject({ membership: { role: "MEMBER" } });

    await expect(
      requireOrganizationRole(
        member.id,
        owner.organization.slug,
        "members:read",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      requireOrganizationOwner(member.id, owner.organization.slug),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      updateOrganizationName(member.id, owner.organization.slug, "Nope"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets ADMIN read members but not manage them or change org settings", async () => {
    const owner = await createTestOwner("Admin Rights");
    const admin = await createTestUser("Org Admin");
    userIds.push(owner.user.id, admin.id);
    organizationIds.push(owner.organization.id);

    await database.organizationMember.create({
      data: {
        userId: admin.id,
        organizationId: owner.organization.id,
        role: "ADMIN",
      },
    });

    const members = await listOrganizationMembers(
      admin.id,
      owner.organization.slug,
    );
    expect(members.length).toBeGreaterThanOrEqual(2);

    await expect(
      updateOrganizationName(admin.id, owner.organization.slug, "Nope"),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const ownerMembership = members.find(
      (membership) => membership.user.id === owner.user.id,
    );
    expect(ownerMembership).toBeTruthy();

    await expect(
      changeOrganizationMemberRole({
        actorUserId: admin.id,
        organizationSlug: owner.organization.slug,
        memberId: ownerMembership!.id,
        role: "MEMBER",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets OWNER update the organization", async () => {
    const { user, organization } = await createTestOwner("Owner Rights");
    userIds.push(user.id);
    organizationIds.push(organization.id);

    const updated = await updateOrganizationName(
      user.id,
      organization.slug,
      "Nieuwe naam",
    );
    expect(updated.name).toBe("Nieuwe naam");
    await requireOrganizationOwner(user.id, organization.slug);
  });
});

describe("last owner protection", () => {
  it("keeps at least one OWNER on an organization", async () => {
    const { user, organization } = await createTestOwner("Last Owner");
    userIds.push(user.id);
    organizationIds.push(organization.id);

    const membership = await database.organizationMember.findFirst({
      where: { organizationId: organization.id, userId: user.id },
    });
    expect(membership).toBeTruthy();

    await expect(
      changeOrganizationMemberRole({
        actorUserId: user.id,
        organizationSlug: organization.slug,
        memberId: membership!.id,
        role: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      removeOrganizationMember({
        actorUserId: user.id,
        organizationSlug: organization.slug,
        memberId: membership!.id,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("allows demotion once another owner exists", async () => {
    const first = await createTestOwner("First Owner");
    const second = await createTestUser("Second Owner");
    userIds.push(first.user.id, second.id);
    organizationIds.push(first.organization.id);

    const extraOwner = await database.organizationMember.create({
      data: {
        userId: second.id,
        organizationId: first.organization.id,
        role: "OWNER",
      },
    });

    const firstMembership = await database.organizationMember.findFirst({
      where: { organizationId: first.organization.id, userId: first.user.id },
    });

    await changeOrganizationMemberRole({
      actorUserId: first.user.id,
      organizationSlug: first.organization.slug,
      memberId: firstMembership!.id,
      role: "ADMIN",
    });

    const remainingOwners = await database.organizationMember.count({
      where: { organizationId: first.organization.id, role: "OWNER" },
    });
    expect(remainingOwners).toBe(1);
    expect(extraOwner.role).toBe("OWNER");
  });
});
