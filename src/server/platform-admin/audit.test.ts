import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./audit";

describe("platform audit metadata", () => {
  it("redacts secrets and click identifiers", () => {
    const encoded = sanitizeAuditMetadata({
      email: "ops@example.com",
      refreshToken: "1//secret",
      gclid: "Cj0KCQjw",
      password: "hunter2",
      STRIPE_SECRET_KEY: "sk_live_123",
      role: "SUPER_ADMIN",
    });
    expect(encoded).toContain("ops@example.com");
    expect(encoded).toContain("SUPER_ADMIN");
    expect(encoded).not.toContain("1//secret");
    expect(encoded).not.toContain("Cj0KCQjw");
    expect(encoded).not.toContain("hunter2");
    expect(encoded).not.toContain("sk_live_123");
  });
});
