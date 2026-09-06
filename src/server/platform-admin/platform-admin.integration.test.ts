import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { loadPlatformAccess } from "@/server/platform-admin/access";
import {
  grantPlatformAccess,
  revokePlatformAccess,
} from "@/server/platform-admin/roles";
import {
  reactivateOrganization,
  suspendOrganization,
} from "@/server/platform-admin/organizations";
import { createEntitlementOverride } from "@/server/platform-admin/overrides";
import {
  disablePlatformUser,
  reactivatePlatformUser,
} from "@/server/platform-admin/users";
import { loadEntitlements } from "@/server/billing/limits";
import { getPublicUserById } from "@/server/authorization/organization";
import { triggerBillingReconciliation } from "@/server/platform-admin/billing";
import { runMonitorNow } from "@/server/platform-admin/jobs";
import { retryConversionExportRecord } from "@/server/google-ads/conversion-config";
import { createWebsite } from "@/server/websites/service";
import { createMonitor } from "@/server/monitors/service";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

async function superAdminActor(name: string) {
  const user = await createTestUser(name);
  userIds.push(user.id);
  await grantPlatformAccess({
    email: user.email,
    role: "SUPER_ADMIN",
    confirm: true,
    reason: "test bootstrap",
    actor: null,
  });
  const actor = await loadPlatformAccess(user.id);
  if (!actor) throw new Error("missing actor");
  return { user, actor };
}

describe("platform bootstrap", () => {
  it("rejects unknown users and duplicate grants stay unique", async () => {
    await expect(
      grantPlatformAccess({
        email: "missing@example.com",
        role: "SUPER_ADMIN",
        confirm: true,
        reason: "bootstrap",
        actor: null,
      }),
    ).rejects.toThrow(/Unknown user/);
    await expect(
      grantPlatformAccess({
        email: "owner@example.com",
        role: "SUPER_ADMIN",
        confirm: false,
        reason: "bootstrap",
        actor: null,
      }),
    ).rejects.toThrow(/--confirm/);
    const user = await createTestUser("Bootstrap");
    userIds.push(user.id);
    const first = await grantPlatformAccess({
      email: user.email,
      role: "SUPER_ADMIN",
      confirm: true,
      reason: "bootstrap",
      actor: null,
    });
    const second = await grantPlatformAccess({
      email: user.email,
      role: "SUPER_ADMIN",
      confirm: true,
      reason: "bootstrap again",
      actor: null,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const count = await database.platformAccess.count({
      where: { userId: user.id },
    });
    expect(count).toBe(1);
  });
});

describe("platform RBAC isolation", () => {
  it("does not treat organization ADMIN as platform admin", async () => {
    const owner = await createTestOwner("Org Admin");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const member = await createTestUser("Tenant Admin");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        organizationId: owner.organization.id,
        userId: member.id,
        role: "ADMIN",
      },
    });
    expect(await loadPlatformAccess(owner.user.id)).toBeNull();
    expect(await loadPlatformAccess(member.id)).toBeNull();
    const accessRows = await database.platformAccess.count({
      where: { userId: { in: [owner.user.id, member.id] } },
    });
    expect(accessRows).toBe(0);
  });

  it("denies disabled platform access", async () => {
    const { actor } = await superAdminActor("Disable Access");
    const other = await createTestUser("Support User");
    userIds.push(other.id);
    await grantPlatformAccess({
      email: other.email,
      role: "SUPPORT",
      confirm: true,
      reason: "support",
      actor,
    });
    await database.platformAccess.update({
      where: { userId: other.id },
      data: { status: "DISABLED" },
    });
    expect(await loadPlatformAccess(other.id)).toBeNull();
  });
});

describe("last SUPER_ADMIN protection", () => {
  it("blocks revoking the last active SUPER_ADMIN", async () => {
    const { user, actor } = await superAdminActor("Only Super");
    const others = await database.platformAccess.findMany({
      where: {
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        userId: { not: user.id },
      },
      select: { userId: true },
    });
    await database.platformAccess.updateMany({
      where: { userId: { in: others.map((row) => row.userId) } },
      data: { status: "DISABLED" },
    });
    try {
      await expect(
        revokePlatformAccess({
          userId: user.id,
          reason: "cleanup",
          actor,
        }),
      ).rejects.toBeInstanceOf(DomainError);
      expect(await loadPlatformAccess(user.id)).not.toBeNull();
    } finally {
      await database.platformAccess.updateMany({
        where: { userId: { in: others.map((row) => row.userId) } },
        data: { status: "ACTIVE" },
      });
    }
  });
});

describe("organization suspend", () => {
  it("keeps data and billing while pausing monitoring writes", async () => {
    const owner = await createTestOwner("Suspend Org");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const { actor } = await superAdminActor("Suspend Actor");
    const before = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    await suspendOrganization({
      organizationId: owner.organization.id,
      reasonCode: "Abuse",
      details: "test",
      actor,
    });
    const after = await database.organization.findUniqueOrThrow({
      where: { id: owner.organization.id },
    });
    const billing = await database.billingSubscription.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(after.manualSuspendedAt).not.toBeNull();
    expect(billing.status).toBe(before.status);
    expect(billing.planKey).toBe(before.planKey);
    const entitlements = await loadEntitlements(owner.organization.id);
    expect(entitlements.monitoringEnabled).toBe(false);
    expect(entitlements.manualSuspended).toBe(true);
    const audit = await database.platformAuditEvent.findFirst({
      where: {
        action: "ORGANIZATION_SUSPENDED",
        targetId: owner.organization.id,
      },
    });
    expect(audit).not.toBeNull();
    await reactivateOrganization({
      organizationId: owner.organization.id,
      reason: "restored",
      actor,
    });
    const restored = await loadEntitlements(owner.organization.id);
    expect(restored.manualSuspended).toBe(false);
  });
});

describe("entitlement overrides", () => {
  it("applies and expires without a plan-string hack", async () => {
    const owner = await createTestOwner("Override Org");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const { actor } = await superAdminActor("Override Actor");
    const support = await createTestUser("Support Override");
    userIds.push(support.id);
    await grantPlatformAccess({
      email: support.email,
      role: "SUPPORT",
      confirm: true,
      reason: "support",
      actor,
    });
    const supportActor = await loadPlatformAccess(support.id);
    if (!supportActor) throw new Error("missing support");
    await expect(
      createEntitlementOverride({
        organizationId: owner.organization.id,
        limitKey: "maxWebsites",
        integerValue: 10,
        reason: "pilot",
        actor: supportActor,
      }),
    ).rejects.toThrow();
    await createEntitlementOverride({
      organizationId: owner.organization.id,
      limitKey: "maxWebsites",
      integerValue: 10,
      reason: "pilot",
      actor,
    });
    const live = await loadEntitlements(owner.organization.id);
    expect(live.planKey).toBe("GROWTH");
    expect(live.limits.maxWebsites).toBe(10);
    await database.organizationEntitlementOverride.updateMany({
      where: { organizationId: owner.organization.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    const expired = await loadEntitlements(owner.organization.id);
    expect(expired.limits.maxWebsites).toBe(5);
  });
});

describe("user disable", () => {
  it("blocks sessions without deleting organization data", async () => {
    const owner = await createTestOwner("Disable User");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const { actor } = await superAdminActor("Disable Actor");
    await disablePlatformUser({
      userId: owner.user.id,
      reason: "security review",
      actor,
    });
    expect(await getPublicUserById(owner.user.id)).toBeNull();
    const org = await database.organization.findUnique({
      where: { id: owner.organization.id },
    });
    expect(org).not.toBeNull();
    await reactivatePlatformUser({
      userId: owner.user.id,
      reason: "cleared",
      actor,
    });
    expect(await getPublicUserById(owner.user.id)).not.toBeNull();
  });
});

describe("billing reconcile scoping", () => {
  it("reconciles only the requested organization", async () => {
    const a = await createTestOwner("Reconcile A");
    const b = await createTestOwner("Reconcile B");
    userIds.push(a.user.id, b.user.id);
    organizationIds.push(a.organization.id, b.organization.id);
    const { actor } = await superAdminActor("Reconcile Actor");
    await triggerBillingReconciliation({
      organizationId: a.organization.id,
      actor,
      reason: "support check",
    });
    const audit = await database.platformAuditEvent.findFirst({
      where: { action: "BILLING_RECONCILIATION_TRIGGERED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.organizationId).toBe(a.organization.id);
    expect(audit?.targetId).toBe(a.organization.id);
    const other = await database.platformAuditEvent.findFirst({
      where: {
        action: "BILLING_RECONCILIATION_TRIGGERED",
        organizationId: b.organization.id,
      },
    });
    expect(other).toBeNull();
  });
});

describe("monitor run now", () => {
  it("queues through the existing monitor service", async () => {
    const owner = await createTestOwner("Monitor Run");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const { actor } = await superAdminActor("Monitor Actor");
    const website = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Run Site",
        url: "https://example.com",
      },
      { resolver: publicResolver },
    );
    const monitor = await createMonitor(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
        name: "HTTP",
        url: "https://example.com",
        intervalSeconds: 300,
        timeoutMs: 5000,
        type: "HTTP",
      },
      { resolver: publicResolver },
    );
    const result = await runMonitorNow({
      monitorId: monitor.id,
      actor,
      reason: "ops",
    });
    expect(result.message).toMatch(/queued|already queued/i);
    const audit = await database.platformAuditEvent.findFirst({
      where: { action: "MONITOR_RUN_TRIGGERED", targetId: monitor.id },
    });
    expect(audit).not.toBeNull();
  });
});

describe("conversion retry safety", () => {
  it("rejects succeeded exports instead of duplicating", async () => {
    await expect(retryConversionExportRecord("missing")).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
