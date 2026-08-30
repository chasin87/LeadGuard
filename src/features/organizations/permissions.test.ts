import { describe, expect, it } from "vitest";
import { assertOwnerChangeAllowed, hasOrganizationPermission } from "./permissions";

describe("organization permissions", () => {
  it("grants roles only their server-side permissions", () => {
    expect(hasOrganizationPermission("OWNER", "organization:update")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "members:view")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "organization:update")).toBe(false);
    expect(hasOrganizationPermission("MEMBER", "members:view")).toBe(false);
  });
  it("protects the final owner", () => expect(() => assertOwnerChangeAllowed({ currentOwnerCount: 1, subjectRole: "OWNER", nextRole: "ADMIN" })).toThrow("LAST_OWNER_PROTECTED"));
});
