import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes with Argon2id and never returns the plaintext", async () => {
    const password = "CorrectHorse1";
    const digest = await hashPassword(password);
    expect(digest).toContain("argon2id");
    expect(digest).not.toContain(password);
    expect(await verifyPassword(digest, password)).toBe(true);
    expect(await verifyPassword(digest, "WrongPassword1")).toBe(false);
  });
});
