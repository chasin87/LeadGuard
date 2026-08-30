import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import {
  completeGoogleAdsOAuth,
  consumeGoogleAdsOAuthState,
  startGoogleAdsOAuth,
} from "@/server/google-ads/oauth";
import { hashOAuthState } from "@/server/google-ads/clients";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";

const userIds: string[] = [];
const organizationIds: string[] = [];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

describe("Google Ads OAuth state", () => {
  it("accepts a valid unused state for the initiating user", async () => {
    const owner = await createTestOwner("OAuth Valid");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const url = await startGoogleAdsOAuth({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
    });
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    );
    expect(state).toBeTruthy();
    const consumed = await consumeGoogleAdsOAuthState({
      state: state!,
      userId: owner.user.id,
    });
    expect(consumed.organizationId).toBe(owner.organization.id);
  });

  it("rejects expired state", async () => {
    const owner = await createTestOwner("OAuth Expired");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const state = "a".repeat(64);
    await database.googleAdsOAuthState.create({
      data: {
        stateHash: hashOAuthState(state),
        organizationId: owner.organization.id,
        userId: owner.user.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(
      consumeGoogleAdsOAuthState({ state, userId: owner.user.id }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects replayed state", async () => {
    const owner = await createTestOwner("OAuth Replay");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const url = await startGoogleAdsOAuth({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
    });
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    )!;
    await consumeGoogleAdsOAuthState({ state, userId: owner.user.id });
    await expect(
      consumeGoogleAdsOAuthState({ state, userId: owner.user.id }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a state from another organization user", async () => {
    const owner = await createTestOwner("OAuth Org Mix");
    const other = await createTestOwner("OAuth Other Org");
    userIds.push(owner.user.id, other.user.id);
    organizationIds.push(owner.organization.id, other.organization.id);
    const url = await startGoogleAdsOAuth({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
    });
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    )!;
    await expect(
      consumeGoogleAdsOAuthState({ state, userId: other.user.id }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("re-checks membership at callback after the initiating user is removed", async () => {
    const owner = await createTestOwner("OAuth Removed");
    const member = await createTestUser("OAuth Member");
    userIds.push(owner.user.id, member.id);
    organizationIds.push(owner.organization.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "ADMIN",
      },
    });
    const url = await startGoogleAdsOAuth({
      userId: member.id,
      organizationSlug: owner.organization.slug,
    });
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    )!;
    await database.organizationMember.deleteMany({
      where: { userId: member.id, organizationId: owner.organization.id },
    });
    await expect(
      completeGoogleAdsOAuth({
        userId: member.id,
        state,
        code: "fake-google-ads-code",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a callback from a different logged-in user", async () => {
    const owner = await createTestOwner("OAuth Wrong User");
    const other = await createTestUser("OAuth Intruder");
    userIds.push(owner.user.id, other.id);
    organizationIds.push(owner.organization.id);
    const url = await startGoogleAdsOAuth({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
    });
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    )!;
    await expect(
      completeGoogleAdsOAuth({
        userId: other.id,
        state,
        code: "fake-google-ads-code",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("does not let a MEMBER start OAuth", async () => {
    const owner = await createTestOwner("OAuth Member Block");
    const member = await createTestUser("Member");
    userIds.push(owner.user.id, member.id);
    organizationIds.push(owner.organization.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    await expect(
      startGoogleAdsOAuth({
        userId: member.id,
        organizationSlug: owner.organization.slug,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
