import { afterAll, describe, expect, it } from "vitest";
import { createTestUser, deleteTestData } from "@/test/helpers";
import {
  completePasswordReset,
  requestPasswordReset,
} from "@/server/auth/password-reset";
import { findUserForCredentials } from "@/server/auth/service";
import { verifyPassword } from "@/server/auth/password";
import { setEmailProviderOverride } from "@/server/notifications/email/provider";
import { createMemoryEmailProvider } from "@/server/notifications/email/memory";
import { DomainError } from "@/server/authorization/errors";

const userIds: string[] = [];

afterAll(async () => {
  setEmailProviderOverride(undefined);
  await deleteTestData({ userIds });
});

describe("password reset", () => {
  it("resets a password from a mailed token and rejects reuse", async () => {
    const mail = createMemoryEmailProvider();
    setEmailProviderOverride(mail);
    const user = await createTestUser("Reset User");
    userIds.push(user.id);
    await requestPasswordReset(user.email);
    const match = mail.messages[0]?.text.match(/token=([^&\s]+)/);
    expect(match?.[1]).toBeTruthy();
    const token = decodeURIComponent(match![1]!);
    await completePasswordReset({ token, password: "NewPassword99" });
    const stored = await findUserForCredentials(user.email);
    expect(stored?.passwordHash).toBeTruthy();
    expect(await verifyPassword(stored!.passwordHash!, "NewPassword99")).toBe(
      true,
    );
    await expect(
      completePasswordReset({ token, password: "AnotherPassword99" }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
