import { describe, expect, it } from "vitest";
import { loginSchema, passwordSchema, registerSchema } from "./auth";

describe("password validation", () => {
  it("accepts a reasonably strong password", () => {
    expect(passwordSchema.parse("CorrectHorse1")).toBe("CorrectHorse1");
  });

  it("rejects short passwords and passwords without letters or numbers", () => {
    expect(passwordSchema.safeParse("short1A").success).toBe(false);
    expect(passwordSchema.safeParse("abcdefghij").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(false);
  });

  it("rejects overly long passwords", () => {
    expect(passwordSchema.safeParse(`A1${"x".repeat(130)}`).success).toBe(
      false,
    );
  });
});

describe("register schema", () => {
  it("normalizes surrounding whitespace on name and email", () => {
    const result = registerSchema.parse({
      name: "  Yasin Yuksek  ",
      email: "  yasin@example.com  ",
      password: "CorrectHorse1",
    });
    expect(result.name).toBe("Yasin Yuksek");
    expect(result.email).toBe("yasin@example.com");
  });
});

describe("login schema", () => {
  it("does not invent a user-specific error message", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "x",
    });
    expect(result.success).toBe(false);
  });
});
