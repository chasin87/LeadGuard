import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { createUserAccount, findUserForCredentials } from "./service";
import {
  createTestUser,
  deleteTestData,
  testPassword,
  uniqueEmail,
} from "@/test/helpers";

const userIds: string[] = [];

afterAll(async () => {
  await deleteTestData({ userIds });
});

describe("auth service", () => {
  it("registers a user without returning a password hash", async () => {
    const email = uniqueEmail("register");
    const user = await createUserAccount({
      name: "Yasin Yuksek",
      email: `  ${email.toUpperCase()}  `,
      password: testPassword,
    });
    userIds.push(user.id);

    expect(user.email).toBe(email);
    expect(user).not.toHaveProperty("passwordHash");

    const stored = await findUserForCredentials(email);
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toContain(testPassword);
  });

  it("rejects a duplicate email", async () => {
    const email = uniqueEmail("duplicate");
    const user = await createUserAccount({
      name: "First",
      email,
      password: testPassword,
    });
    userIds.push(user.id);

    await expect(
      createUserAccount({
        name: "Second",
        email,
        password: testPassword,
      }),
    ).rejects.toThrow(/al in gebruik/i);
  });

  it("stores credentials so a later lookup can verify them", async () => {
    const user = await createTestUser("Login User");
    userIds.push(user.id);
    const stored = await findUserForCredentials(user.email);
    expect(stored?.id).toBe(user.id);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe("database constraints", () => {
  it("enforces unique emails at the database layer", async () => {
    const email = uniqueEmail("constraint");
    const first = await createUserAccount({
      name: "One",
      email,
      password: testPassword,
    });
    userIds.push(first.id);

    await expect(
      database.user.create({
        data: {
          name: "Two",
          email,
          passwordHash: "not-a-real-hash",
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
