import { describe, expect, it } from "vitest";
import { loginSchema, registrationSchema } from "./schemas";

describe("authentication input", () => {
  it("normalizes email during registration", () => expect(registrationSchema.parse({ name: "Yasin", email: " YASIN@Example.com ", password: "a strong password", organizationName: "Voltios" }).email).toBe("yasin@example.com"));
  it("rejects short passwords", () => expect(registrationSchema.safeParse({ name: "Yasin", email: "yasin@example.com", password: "short", organizationName: "Voltios" }).success).toBe(false));
  it("accepts valid login credentials", () => expect(loginSchema.safeParse({ email: "yasin@example.com", password: "a strong password" }).success).toBe(true));
});
