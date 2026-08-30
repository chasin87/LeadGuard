import { describe, expect, it } from "vitest";
import { authorizeOrganizationMembership, type MembershipContext } from "./authorization";

const now = new Date();
const memberships: Record<string, MembershipContext> = {
  "user-a:organization-a": { id: "member-a", role: "OWNER", organization: { id: "org-a", name: "A", slug: "organization-a", createdAt: now, updatedAt: now } },
  "user-b:organization-b": { id: "member-b", role: "OWNER", organization: { id: "org-b", name: "B", slug: "organization-b", createdAt: now, updatedAt: now } },
};
const lookup = async (userId: string, slug: string) => memberships[`${userId}:${slug}`] ?? null;

describe("tenant isolation", () => {
  it("allows a member to read their own organization", async () => expect(await authorizeOrganizationMembership("user-a", "organization-a", lookup)).toMatchObject({ id: "member-a" }));
  it("rejects slug manipulation across tenants", async () => expect(await authorizeOrganizationMembership("user-a", "organization-b", lookup)).toBeNull());
  it("rejects an organization id substituted for the route slug", async () => expect(await authorizeOrganizationMembership("user-a", "org-b", lookup)).toBeNull());
  it("does not leak memberships to an outsider", async () => expect(await authorizeOrganizationMembership("user-a", "organization-b", lookup)).toBeNull());
});
