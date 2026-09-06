import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import { claimDueMonitors } from "@/server/monitoring/scheduler";
import {
  disconnectMonitorLocks,
  executeMonitorJob,
} from "@/server/monitoring/runner";
import { stopMonitorQueue } from "@/jobs/queue";
import {
  createMonitor,
  deleteMonitor,
  enqueueFormRealTest,
  enqueueManualMonitorCheck,
  getMonitor,
  listMonitorChecks,
  listMonitors,
  setMonitorStatus,
  updateMonitor,
} from "@/server/monitors/service";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { resetRateLimitStore } from "@/server/auth/rate-limit";
import { MonitorNotFoundError } from "@/server/security/errors";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicIpv4 = "93.184.216.34";
const publicResolver: DnsResolver = async () => [publicIpv4];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
  await stopMonitorQueue().catch(() => undefined);
  await disconnectMonitorLocks().catch(() => undefined);
});

function uniqueHost(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

async function addMember(
  organizationId: string,
  userId: string,
  role: "ADMIN" | "MEMBER",
) {
  await database.organizationMember.create({
    data: { organizationId, userId, role },
  });
}

async function seedWebsite(name: string) {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
  const host = uniqueHost(name.toLowerCase().replace(/\s+/g, "-"));
  const website = await createWebsite(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      name,
      url: host,
    },
    { resolver: publicResolver },
  );
  return { ...owner, website, host };
}

describe("monitor CRUD and isolation", () => {
  it("lets OWNER and ADMIN manage monitors while MEMBER is read-only", async () => {
    const seeded = await seedWebsite("Monitor Roles");
    const admin = await createTestUser("Monitor Admin");
    const member = await createTestUser("Monitor Member");
    userIds.push(admin.id, member.id);
    await addMember(seeded.organization.id, admin.id, "ADMIN");
    await addMember(seeded.organization.id, member.id, "MEMBER");

    const created = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Homepage",
        url: `https://${seeded.host}/`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    expect(created.normalizedUrl).toBe(`https://${seeded.host}/`);

    await createMonitor(
      {
        userId: admin.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Airco",
        url: `/airco`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );

    const listed = await listMonitors(
      member.id,
      seeded.organization.slug,
      seeded.website.id,
    );
    expect(listed).toHaveLength(2);

    await expect(
      createMonitor(
        {
          userId: member.id,
          organizationSlug: seeded.organization.slug,
          websiteId: seeded.website.id,
          name: "Nope",
          url: "/blocked",
          intervalSeconds: 300,
          timeoutMs: 10_000,
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      updateMonitor(
        {
          userId: member.id,
          organizationSlug: seeded.organization.slug,
          websiteId: seeded.website.id,
          monitorId: created.id,
          name: "Hacked",
          url: created.normalizedUrl,
          intervalSeconds: 300,
          timeoutMs: 10_000,
          status: "PAUSED",
          consecutiveFailuresBeforeIncident: 2,
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a monitor on a different host and blocks cross-tenant access", async () => {
    const tenantA = await seedWebsite("Monitor Tenant A");
    const tenantB = await seedWebsite("Monitor Tenant B");
    const monitorA = await createMonitor(
      {
        userId: tenantA.user.id,
        organizationSlug: tenantA.organization.slug,
        websiteId: tenantA.website.id,
        name: "Alpha",
        url: `https://${tenantA.host}/page`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    const monitorB = await createMonitor(
      {
        userId: tenantB.user.id,
        organizationSlug: tenantB.organization.slug,
        websiteId: tenantB.website.id,
        name: "Secret Beta Monitor",
        url: `https://${tenantB.host}/secret`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );

    await expect(
      createMonitor(
        {
          userId: tenantA.user.id,
          organizationSlug: tenantA.organization.slug,
          websiteId: tenantA.website.id,
          name: "WWW",
          url: `https://www.${tenantA.host}/page`,
          intervalSeconds: 300,
          timeoutMs: 10_000,
        },
        { resolver: publicResolver },
      ),
    ).rejects.toMatchObject({
      message: "Monitor URLs must stay on the same host as the website.",
    });

    await expect(
      getMonitor(
        tenantA.user.id,
        tenantA.organization.slug,
        tenantA.website.id,
        monitorB.id,
      ),
    ).rejects.toBeInstanceOf(MonitorNotFoundError);

    await expect(
      listMonitorChecks(
        tenantA.user.id,
        tenantA.organization.slug,
        tenantA.website.id,
        monitorB.id,
      ),
    ).rejects.toBeInstanceOf(MonitorNotFoundError);

    await expect(
      deleteMonitor({
        userId: tenantA.user.id,
        organizationSlug: tenantA.organization.slug,
        websiteId: tenantA.website.id,
        monitorId: monitorB.id,
      }),
    ).rejects.toBeInstanceOf(MonitorNotFoundError);

    await expect(
      enqueueManualMonitorCheck({
        userId: tenantA.user.id,
        organizationSlug: tenantA.organization.slug,
        websiteId: tenantA.website.id,
        monitorId: monitorB.id,
      }),
    ).rejects.toBeInstanceOf(MonitorNotFoundError);

    const stillB = await getMonitor(
      tenantB.user.id,
      tenantB.organization.slug,
      tenantB.website.id,
      monitorB.id,
    );
    expect(stillB.name).toBe("Secret Beta Monitor");
    expect(monitorA.id).not.toBe(monitorB.id);
  });
});

describe("scheduler and worker", () => {
  it("claims only due active monitors and does not flood after downtime", async () => {
    const seeded = await seedWebsite("Scheduler Due");
    const due = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Due",
        url: `https://${seeded.host}/due`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    const future = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Future",
        url: `https://${seeded.host}/future`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );

    const overdue = new Date(0);
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    await database.monitor.update({
      where: { id: due.id },
      data: { nextCheckAt: overdue },
    });
    await database.monitor.update({
      where: { id: future.id },
      data: { nextCheckAt: inAnHour },
    });

    const paused = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Paused",
        url: `https://${seeded.host}/paused`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    await setMonitorStatus({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      websiteId: seeded.website.id,
      monitorId: paused.id,
      status: "PAUSED",
    });
    await database.monitor.update({
      where: { id: paused.id },
      data: { nextCheckAt: overdue },
    });

    const now = new Date();
    const claimed = await claimDueMonitors(now);
    const claimedIds = claimed.map((row) => row.id);
    expect(claimedIds).toContain(due.id);
    expect(claimedIds).not.toContain(future.id);
    expect(claimedIds).not.toContain(paused.id);

    const updatedDue = await database.monitor.findUnique({
      where: { id: due.id },
    });
    expect(updatedDue?.nextCheckAt.getTime()).toBeGreaterThanOrEqual(
      now.getTime() + 300_000 - 50,
    );

    const second = await claimDueMonitors(now);
    expect(second.map((row) => row.id)).not.toContain(due.id);
  });

  it("does not schedule monitors for a disabled website", async () => {
    const seeded = await seedWebsite("Disabled Website");
    const monitor = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Off",
        url: `https://${seeded.host}/off`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    await database.website.update({
      where: { id: seeded.website.id },
      data: { status: "DISABLED" },
    });
    await database.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() - 60_000) },
    });
    const claimed = await claimDueMonitors();
    expect(claimed.map((row) => row.id)).not.toContain(monitor.id);
  });

  it("stores a check result and updates lastCheckedAt", async () => {
    const seeded = await seedWebsite("Worker Result");
    const monitor = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Checked",
        url: `https://${seeded.host}/ok`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );

    const outcome = await executeMonitorJob(monitor.id, {
      jobId: "job-test-1",
      resolver: publicResolver,
      transport: async () => ({ statusCode: 200, headers: {} }),
    });
    expect(outcome).toBe("completed");

    const checks = await listMonitorChecks(
      seeded.user.id,
      seeded.organization.slug,
      seeded.website.id,
      monitor.id,
    );
    expect(checks[0]?.status).toBe("SUCCESS");
    expect(checks[0]?.httpStatus).toBe(200);

    const updated = await database.monitor.findUnique({
      where: { id: monitor.id },
    });
    expect(updated?.lastCheckedAt).toBeTruthy();
    expect(updated?.consecutiveFailures).toBe(0);

    await executeMonitorJob(monitor.id, {
      resolver: publicResolver,
      transport: async () => ({ statusCode: 404, headers: {} }),
    });
    const afterFail = await database.monitor.findUnique({
      where: { id: monitor.id },
    });
    expect(afterFail?.consecutiveFailures).toBe(1);
  });

  it("skips paused monitors and does not create a check", async () => {
    const seeded = await seedWebsite("Skip Paused");
    const monitor = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Paused worker",
        url: `https://${seeded.host}/skip`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    await setMonitorStatus({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      websiteId: seeded.website.id,
      monitorId: monitor.id,
      status: "PAUSED",
    });
    const outcome = await executeMonitorJob(monitor.id, {
      transport: async () => ({ statusCode: 200, headers: {} }),
    });
    expect(outcome).toBe("skipped");
    const checks = await database.monitorCheck.count({
      where: { monitorId: monitor.id },
    });
    expect(checks).toBe(0);
  });
});

describe("queue uniqueness", () => {
  it("does not enqueue two active jobs for the same monitor", async () => {
    const seeded = await seedWebsite("Queue Unique");
    const monitor = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Once",
        url: `https://${seeded.host}/once`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    const first = await enqueueManualMonitorCheck({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      websiteId: seeded.website.id,
      monitorId: monitor.id,
    });
    expect(first.queued).toBe(true);
    resetRateLimitStore();
    const second = await enqueueManualMonitorCheck({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      websiteId: seeded.website.id,
      monitorId: monitor.id,
    });
    expect(second.queued).toBe(false);
  });
});

describe("form monitor safety", () => {
  const formFields = {
    type: "FORM" as const,
    intervalSeconds: 21600,
    timeoutMs: 30_000,
    viewport: "DESKTOP" as const,
    formSelector: "form#quote-form",
    submitSelector: 'button[type="submit"]',
    fieldMappings: [
      { role: "EMAIL", control: "EMAIL", selector: 'input[name="email"]' },
    ],
    successMode: "ANY" as const,
    successSelector: ".thank-you",
    testDisplayName: "LeadGuard Test",
    testEmail: "leadtests@example.com",
    consented: true,
  };

  it("creates FORM monitors paused and blocks scheduled activation until verified", async () => {
    const seeded = await seedWebsite("Form Safety");
    const monitor = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Quote form",
        url: `https://${seeded.host}/offerte`,
        ...formFields,
      },
      { resolver: publicResolver },
    );
    expect(monitor.status).toBe("PAUSED");
    await expect(
      setMonitorStatus({
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        monitorId: monitor.id,
        status: "ACTIVE",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("does not let MEMBER send a real form test", async () => {
    const seeded = await seedWebsite("Form Member");
    const member = await createTestUser("Form Member User");
    userIds.push(member.id);
    await addMember(seeded.organization.id, member.id, "MEMBER");
    const monitor = await createMonitor(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        name: "Quote form",
        url: `https://${seeded.host}/offerte`,
        ...formFields,
      },
      { resolver: publicResolver },
    );
    await expect(
      enqueueFormRealTest({
        userId: member.id,
        organizationSlug: seeded.organization.slug,
        websiteId: seeded.website.id,
        monitorId: monitor.id,
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
