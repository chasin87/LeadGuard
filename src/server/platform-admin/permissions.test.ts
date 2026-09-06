import { describe, expect, it } from "vitest";
import { hasPlatformPermission } from "./permissions";

describe("platform permissions", () => {
  it("allows SUPER_ADMIN every platform permission", () => {
    expect(hasPlatformPermission("SUPER_ADMIN", "platform:overview")).toBe(
      true,
    );
    expect(
      hasPlatformPermission("SUPER_ADMIN", "platform:organizations:manage"),
    ).toBe(true);
    expect(
      hasPlatformPermission("SUPER_ADMIN", "platform:billing:manage"),
    ).toBe(true);
    expect(hasPlatformPermission("SUPER_ADMIN", "platform:roles:manage")).toBe(
      true,
    );
    expect(hasPlatformPermission("SUPER_ADMIN", "platform:revenue:read")).toBe(
      true,
    );
  });

  it("limits SUPPORT to read and constrained support actions", () => {
    expect(hasPlatformPermission("SUPPORT", "platform:overview")).toBe(true);
    expect(
      hasPlatformPermission("SUPPORT", "platform:organizations:read"),
    ).toBe(true);
    expect(hasPlatformPermission("SUPPORT", "platform:users:read")).toBe(true);
    expect(hasPlatformPermission("SUPPORT", "platform:monitoring:manage")).toBe(
      true,
    );
    expect(
      hasPlatformPermission("SUPPORT", "platform:organizations:manage"),
    ).toBe(false);
    expect(hasPlatformPermission("SUPPORT", "platform:users:manage")).toBe(
      false,
    );
    expect(hasPlatformPermission("SUPPORT", "platform:billing:manage")).toBe(
      false,
    );
    expect(hasPlatformPermission("SUPPORT", "platform:roles:manage")).toBe(
      false,
    );
    expect(hasPlatformPermission("SUPPORT", "platform:revenue:read")).toBe(
      false,
    );
    expect(hasPlatformPermission("SUPPORT", "platform:revenue:summary")).toBe(
      true,
    );
  });
});
