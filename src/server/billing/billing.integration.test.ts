import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { AuthorizationError } from "@/server/authorization/errors";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import type { DnsResolver } from "@/server/security/ssrf";
import { PlanLimitError } from "@/server/billing/limits";
import { calculateEntitlements } from "@/server/billing/entitlements";
import {
  applyVerifiedBillingEvent,
  mapProviderStatus,
  projectProviderSubscription,
  reconcileBillingSubscriptions,
} from "@/server/billing/projection";
import {
  createCheckoutSession,
  createPortalSession,
  startOrganizationTrial,
} from "@/server/billing/service";
import {
  createFakeBillingProvider,
  fakePriceEnv,
  resetFakeBillingWorld,
} from "@/server/billing/fake";
import { resetBillingProviderCache } from "@/server/billing/clients";
import { getOrganizationUsage } from "@/server/billing/usage";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicIpv4 = "93.184.216.34";
const publicResolver: DnsResolver = async () => [publicIpv4];

function uniqueHost(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

beforeEach(() => {
  resetFakeBillingWorld();
  resetBillingProviderCache();
  Object.assign(process.env, fakePriceEnv());
  process.env.BILLING_PROVIDER = "fake";
});

describe("billing status mapping", () => {
  it("maps Stripe statuses to internal statuses", () => {
    expect(mapProviderStatus("trialing")).toBe("TRIALING");
    expect(mapProviderStatus("active")).toBe("ACTIVE");
    expect(mapProviderStatus("past_due")).toBe("PAST_DUE");
    expect(mapProviderStatus("canceled")).toBe("CANCELED");
    expect(mapProviderStatus("unpaid")).toBe("SUSPENDED");
  });
});

describe("organization billing lifecycle", () => {
  it("starts a trial for a new organization and blocks a second trial", async () => {
    const owner = await createTestOwner("Trial Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const first = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(first.status).toBe("TRIALING");
    expect(first.planKey).toBe("GROWTH");
    await startOrganizationTrial({
      organizationId: owner.organization.id,
      ownerUserId: owner.user.id,
    });
    const again = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(again.id).toBe(first.id);
  });

  it("lets OWNER create Checkout and reuses the Stripe customer", async () => {
    const owner = await createTestOwner("Checkout Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const first = await createCheckoutSession({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      planKey: "GROWTH",
    });
    const second = await createCheckoutSession({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      planKey: "GROWTH",
    });
    expect(first.sessionId).toBe(second.sessionId);
    const customers = await database.billingCustomer.count({
      where: { organizationId: owner.organization.id },
    });
    expect(customers).toBe(1);
  });

  it("denies MEMBER checkout, portal, and arbitrary price keys", async () => {
    const owner = await createTestOwner("Billing Member");
    const member = await createTestUser("Billing Member User");
    userIds.push(owner.user.id, member.id);
    organizationIds.push(owner.organization.id);
    await database.organizationMember.create({
      data: {
        organizationId: owner.organization.id,
        userId: member.id,
        role: "MEMBER",
      },
    });
    await expect(
      createCheckoutSession({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        planKey: "GROWTH",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createPortalSession({
        userId: member.id,
        organizationSlug: owner.organization.slug,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createCheckoutSession({
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        planKey: "price_other_tenant",
      }),
    ).rejects.toThrow(/valid LeadGuard plan/);
  });

  it("projects a verified webhook once even when the event is replayed", async () => {
    const owner = await createTestOwner("Webhook Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const checkout = await createCheckoutSession({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      planKey: "PRO",
    });
    const fake = createFakeBillingProvider();
    const event = fake.completeCheckout(checkout.sessionId);
    await applyVerifiedBillingEvent(event);
    await applyVerifiedBillingEvent(event);
    const subscription = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.planKey).toBe("PRO");
    expect(subscription.provider).toBe("FAKE");
    const events = await database.billingProviderEvent.count({
      where: { providerEventId: event.id },
    });
    expect(events).toBe(1);
  });

  it("ignores an older out-of-order subscription event", async () => {
    const owner = await createTestOwner("Stale Event");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    await database.billingCustomer.create({
      data: {
        organizationId: owner.organization.id,
        provider: "FAKE",
        providerCustomerId: `cus_fake_${owner.organization.id}`,
      },
    });
    const now = new Date("2026-09-10T12:00:00.000Z");
    await projectProviderSubscription({
      organizationId: owner.organization.id,
      eventCreatedAt: now,
      subscription: {
        id: "sub_new",
        customerId: `cus_fake_${owner.organization.id}`,
        status: "active",
        priceId: "price_fake_pro",
        quantity: 1,
        currentPeriodStart: now,
        currentPeriodEnd: new Date("2026-10-10T12:00:00.000Z"),
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
        created: now,
      },
    });
    await projectProviderSubscription({
      organizationId: owner.organization.id,
      eventCreatedAt: new Date("2026-09-01T12:00:00.000Z"),
      subscription: {
        id: "sub_old",
        customerId: `cus_fake_${owner.organization.id}`,
        status: "canceled",
        priceId: "price_fake_starter",
        quantity: 1,
        currentPeriodStart: now,
        currentPeriodEnd: now,
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: now,
        endedAt: now,
        created: now,
      },
    });
    const subscription = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(subscription.planKey).toBe("PRO");
    expect(subscription.status).toBe("ACTIVE");
  });

  it("marks an unknown price as NEEDS_REVIEW instead of granting Pro", async () => {
    const owner = await createTestOwner("Unknown Price");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    await database.billingCustomer.create({
      data: {
        organizationId: owner.organization.id,
        provider: "FAKE",
        providerCustomerId: `cus_unknown_${owner.organization.id}`,
      },
    });
    await projectProviderSubscription({
      organizationId: owner.organization.id,
      eventCreatedAt: new Date(),
      subscription: {
        id: "sub_unknown",
        customerId: `cus_unknown_${owner.organization.id}`,
        status: "active",
        priceId: "price_not_in_catalog",
        quantity: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date("2026-10-10T00:00:00.000Z"),
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
        created: new Date(),
      },
    });
    const subscription = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(subscription.status).toBe("NEEDS_REVIEW");
    expect(subscription.planKey).not.toBe("PRO");
  });

  it("keeps resources after a downgrade and blocks new websites", async () => {
    const owner = await createTestOwner("Downgrade Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const first = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "One",
        url: uniqueHost("one"),
      },
      { resolver: publicResolver },
    );
    const second = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Two",
        url: uniqueHost("two"),
      },
      { resolver: publicResolver },
    );
    await database.billingSubscription.update({
      where: { organizationId: owner.organization.id },
      data: { planKey: "STARTER", status: "ACTIVE", provider: "INTERNAL" },
    });
    const usage = await getOrganizationUsage(owner.organization.id);
    const entitlements = calculateEntitlements({
      planKey: "STARTER",
      status: "ACTIVE",
      trialEnd: null,
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      graceDeadlineAt: null,
      now: new Date(),
      usage,
    });
    expect(entitlements.overLimit).toBe(true);
    expect(entitlements.monitoringEnabled).toBe(true);
    await expect(
      createWebsite(
        {
          userId: owner.user.id,
          organizationSlug: owner.organization.slug,
          name: "Three",
          url: uniqueHost("three"),
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(
      await database.website.count({
        where: { organizationId: owner.organization.id },
      }),
    ).toBe(2);
    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();
  });

  it("allows only one of two concurrent website creates at the Starter limit", async () => {
    const owner = await createTestOwner("Race Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    await database.billingSubscription.update({
      where: { organizationId: owner.organization.id },
      data: { planKey: "STARTER", status: "ACTIVE" },
    });
    const results = await Promise.allSettled([
      createWebsite(
        {
          userId: owner.user.id,
          organizationSlug: owner.organization.slug,
          name: "A",
          url: uniqueHost("race-a"),
        },
        { resolver: publicResolver },
      ),
      createWebsite(
        {
          userId: owner.user.id,
          organizationSlug: owner.organization.slug,
          name: "B",
          url: uniqueHost("race-b"),
        },
        { resolver: publicResolver },
      ),
    ]);
    const ok = results.filter((result) => result.status === "fulfilled");
    const denied = results.filter((result) => result.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(1);
  });

  it("suspends after grace expiry and restores on recovery", async () => {
    const owner = await createTestOwner("Grace Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    await database.billingCustomer.create({
      data: {
        organizationId: owner.organization.id,
        provider: "FAKE",
        providerCustomerId: `cus_grace_${owner.organization.id}`,
      },
    });
    await database.billingSubscription.update({
      where: { organizationId: owner.organization.id },
      data: {
        provider: "FAKE",
        providerSubscriptionId: `sub_grace_${owner.organization.id}`,
        status: "PAST_DUE",
        planKey: "GROWTH",
        graceDeadlineAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    await reconcileBillingSubscriptions(new Date("2026-09-10T00:00:00.000Z"));
    expect(
      (
        await database.billingSubscription.findUniqueOrThrow({
          where: { organizationId: owner.organization.id },
        })
      ).status,
    ).toBe("SUSPENDED");
    await projectProviderSubscription({
      organizationId: owner.organization.id,
      eventCreatedAt: new Date("2026-09-11T00:00:00.000Z"),
      subscription: {
        id: `sub_grace_${owner.organization.id}`,
        customerId: `cus_grace_${owner.organization.id}`,
        status: "active",
        priceId: "price_fake_growth",
        quantity: 1,
        currentPeriodStart: new Date("2026-09-11T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-11T00:00:00.000Z"),
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
        created: new Date("2026-09-11T00:00:00.000Z"),
      },
    });
    expect(
      (
        await database.billingSubscription.findUniqueOrThrow({
          where: { organizationId: owner.organization.id },
        })
      ).status,
    ).toBe("ACTIVE");
  });

  it("does not suspend a grandfathered organization", async () => {
    const owner = await createTestOwner("Legacy Owner");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    await database.billingSubscription.update({
      where: { organizationId: owner.organization.id },
      data: {
        provider: "INTERNAL",
        planKey: "LEGACY",
        status: "ACTIVE",
        currentPeriodEnd: new Date("2099-12-31T23:59:59.000Z"),
      },
    });
    await reconcileBillingSubscriptions(new Date());
    expect(
      (
        await database.billingSubscription.findUniqueOrThrow({
          where: { organizationId: owner.organization.id },
        })
      ).status,
    ).toBe("ACTIVE");
  });
});
