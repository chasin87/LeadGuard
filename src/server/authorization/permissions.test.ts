import { describe, expect, it } from "vitest";
import { hasOrganizationPermission } from "./permissions";

describe("organization permissions", () => {
  it("gives MEMBER dashboard access but not owner rights", () => {
    expect(hasOrganizationPermission("MEMBER", "organization:read")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "organization:update")).toBe(
      false,
    );
    expect(hasOrganizationPermission("MEMBER", "members:read")).toBe(false);
    expect(hasOrganizationPermission("MEMBER", "members:manage")).toBe(false);
  });

  it("gives ADMIN member-read access without owner management", () => {
    expect(hasOrganizationPermission("ADMIN", "organization:read")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "members:read")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "members:manage")).toBe(false);
    expect(hasOrganizationPermission("ADMIN", "organization:update")).toBe(
      false,
    );
  });

  it("gives OWNER full organization control", () => {
    expect(hasOrganizationPermission("OWNER", "organization:update")).toBe(
      true,
    );
    expect(hasOrganizationPermission("OWNER", "members:manage")).toBe(true);
    expect(hasOrganizationPermission("OWNER", "settings:update")).toBe(true);
  });

  it("lets MEMBER read websites but not manage them", () => {
    expect(hasOrganizationPermission("MEMBER", "websites:read")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "websites:manage")).toBe(false);
    expect(hasOrganizationPermission("ADMIN", "websites:manage")).toBe(true);
    expect(hasOrganizationPermission("OWNER", "websites:manage")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "monitors:read")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "monitors:manage")).toBe(false);
    expect(hasOrganizationPermission("ADMIN", "monitors:manage")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "incidents:read")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "incidents:read")).toBe(true);
    expect(hasOrganizationPermission("OWNER", "incidents:read")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "notifications:read")).toBe(
      true,
    );
    expect(hasOrganizationPermission("MEMBER", "notifications:manage")).toBe(
      false,
    );
    expect(hasOrganizationPermission("ADMIN", "notifications:manage")).toBe(
      true,
    );
    expect(hasOrganizationPermission("MEMBER", "integrations:read")).toBe(true);
    expect(hasOrganizationPermission("MEMBER", "integrations:manage")).toBe(
      false,
    );
    expect(hasOrganizationPermission("ADMIN", "integrations:manage")).toBe(
      true,
    );
    expect(hasOrganizationPermission("OWNER", "integrations:manage")).toBe(
      true,
    );
  });
});
