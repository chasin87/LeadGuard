import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import { createMonitor, deleteMonitor } from "@/server/monitors/service";
import {
  persistAndProcessCheck,
  reprocessMonitorCheck,
} from "@/server/incidents/engine";
import { executeMonitorJob } from "@/server/monitoring/runner";
import { stopMonitorQueue } from "@/jobs/queue";
import { disconnectMonitorLocks } from "@/server/monitoring/runner";
import type { HttpCheckResult } from "@/server/monitoring/http-check";
import type { DnsResolver } from "@/server/security/ssrf";
import {
  getOrganizationIncident,
  listOrganizationIncidents,
} from "@/server/incidents/service";
import { IncidentNotFoundError } from "@/server/security/errors";
import { AuthorizationError } from "@/server/authorization/errors";

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

let sequence = 0;

function nextWindow() {
  sequence += 1;
  const startedAt = new Date(Date.UTC(2026, 7, 30, 14, sequence, 0));
  const finishedAt = new Date(startedAt.getTime() + 200);
  return { startedAt, finishedAt };
}

function checkResult(
  partial: Partial<HttpCheckResult> & Pick<HttpCheckResult, "status">,
): HttpCheckResult {
  return {
    httpStatus: null,
    responseTimeMs: 40,
    requestedUrl: "https://example.com/page",
    finalUrl: "https://example.com/page",
    redirectCount: 0,
    resolvedIp: publicIpv4,
    errorType: null,
    errorMessage: null,
    ...partial,
  };
}

async function seedMonitor(name: string, threshold = 2, urlPath = "/page") {
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
  const monitor = await createMonitor(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      name: `${name} monitor`,
      url: `https://${host}${urlPath}`,
      intervalSeconds: 300,
      timeoutMs: 10_000,
      consecutiveFailuresBeforeIncident: threshold,
    },
    { resolver: publicResolver },
  );
  return { ...owner, website, monitor, host };
}

async function applyCheck(
  seeded: Awaited<ReturnType<typeof seedMonitor>>,
  result: HttpCheckResult,
  times = nextWindow(),
) {
  return persistAndProcessCheck({
    monitorId: seeded.monitor.id,
    organizationId: seeded.organization.id,
    websiteId: seeded.website.id,
    startedAt: times.startedAt,
    finishedAt: times.finishedAt,
    result,
  });
}

async function incidentsFor(monitorId: string) {
  return database.incident.findMany({
    where: { monitorId },
    orderBy: { createdAt: "asc" },
  });
}

describe("incident engine", () => {
  it("opens exactly one incident after two consecutive failures", async () => {
    const seeded = await seedMonitor("Open After Two");
    const success = await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    const firstFail = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    const secondFail = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );

    expect(success.outcome.kind).toBe("none");
    expect(firstFail.outcome.kind).toBe("none");
    expect(secondFail.outcome.kind).toBe("opened");

    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("OPEN");
    expect(rows[0]?.failureCount).toBe(2);
    expect(rows[0]?.firstFailedCheckId).toBe(firstFail.checkId);
    expect(rows[0]?.lastFailedCheckId).toBe(secondFail.checkId);
    expect(rows[0]?.startedAt.getTime()).toBeLessThan(
      rows[0]!.detectedAt.getTime(),
    );
    const opened = await database.notificationOutboxEvent.findMany({
      where: { aggregateId: rows[0]!.id },
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.eventType).toBe("INCIDENT_OPENED");
  });

  it("does not open an incident for a transient failure", async () => {
    const seeded = await seedMonitor("Transient");
    await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 404,
        errorType: "HTTP_404",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(0);
    expect(
      await database.notificationOutboxEvent.count({
        where: { organizationId: seeded.organization.id },
      }),
    ).toBe(0);
  });

  it("keeps one incident and increments failureCount on continued failures", async () => {
    const seeded = await seedMonitor("Continued");
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failureCount).toBe(4);
    expect(
      await database.notificationOutboxEvent.findMany({
        where: { aggregateId: rows[0]!.id },
      }),
    ).toEqual([expect.objectContaining({ eventType: "INCIDENT_OPENED" })]);
  });

  it("resolves on SUCCESS and records recovery", async () => {
    const seeded = await seedMonitor("Recovery");
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    const recovered = await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("RESOLVED");
    expect(rows[0]?.recoveryCheckId).toBe(recovered.checkId);
    expect(rows[0]?.resolvedAt?.getTime()).toBeGreaterThan(0);
    const monitor = await database.monitor.findUnique({
      where: { id: seeded.monitor.id },
    });
    expect(monitor?.consecutiveFailures).toBe(0);
    const events = await database.notificationOutboxEvent.findMany({
      where: { aggregateId: rows[0]!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "INCIDENT_OPENED",
      "INCIDENT_RESOLVED",
    ]);
  });

  it("opens a second incident after recovery", async () => {
    const seeded = await seedMonitor("Second Incident");
    const fail = (status = 500) =>
      applyCheck(
        seeded,
        checkResult({
          status: "FAILURE",
          httpStatus: status,
          errorType: "HTTP_5XX",
        }),
      );
    await fail();
    await fail();
    await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    await fail();
    await fail();
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("RESOLVED");
    expect(rows[1]?.status).toBe("OPEN");
  });

  it("keeps one incident when the error type changes", async () => {
    const seeded = await seedMonitor("Changing Error");
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: null,
        errorType: "TIMEOUT",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: null,
        errorType: "DNS_ERROR",
      }),
    );
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.initialErrorType).toBe("HTTP_5XX");
    expect(rows[0]?.latestErrorType).toBe("DNS_ERROR");
    expect(rows[0]?.failureCount).toBe(4);
  });

  it("treats DEGRADED as recovery and resets the failure counter", async () => {
    const seeded = await seedMonitor("Degraded Policy");
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await applyCheck(
      seeded,
      checkResult({ status: "DEGRADED", httpStatus: 200 }),
    );
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(0);
  });

  it("opens immediately when the threshold is 1", async () => {
    const seeded = await seedMonitor("Threshold One", 1);
    const times = nextWindow();
    const failed = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 404,
        errorType: "HTTP_404",
      }),
      times,
    );
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstFailedCheckId).toBe(failed.checkId);
    expect(rows[0]?.startedAt.getTime()).toBe(times.startedAt.getTime());
    expect(rows[0]?.detectedAt.getTime()).toBe(times.finishedAt.getTime());
  });

  it("does not open at threshold 3 until the third failure", async () => {
    const seeded = await seedMonitor("Threshold Three", 3);
    const fail = () =>
      applyCheck(
        seeded,
        checkResult({
          status: "FAILURE",
          httpStatus: 503,
          errorType: "HTTP_5XX",
        }),
      );
    await fail();
    await fail();
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(0);
    await fail();
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(1);
  });

  it("does not open an incident when only the threshold setting changes", async () => {
    const seeded = await seedMonitor("Policy Change", 3);
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { consecutiveFailuresBeforeIncident: 1 },
    });
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(0);
  });

  it("serializes concurrent failures into at most one open incident", async () => {
    const seeded = await seedMonitor("Concurrency", 1);
    await Promise.all([
      applyCheck(
        seeded,
        checkResult({
          status: "FAILURE",
          httpStatus: 500,
          errorType: "HTTP_5XX",
        }),
      ),
      applyCheck(
        seeded,
        checkResult({
          status: "FAILURE",
          httpStatus: 500,
          errorType: "HTTP_5XX",
        }),
      ),
    ]);
    const open = await database.incident.count({
      where: { monitorId: seeded.monitor.id, status: "OPEN" },
    });
    expect(open).toBe(1);
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failureCount).toBeGreaterThanOrEqual(1);
  });

  it("does not double-count when the same check is processed twice", async () => {
    const seeded = await seedMonitor("Idempotent", 1);
    const first = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    const again = await reprocessMonitorCheck({
      checkId: first.checkId,
      organizationId: seeded.organization.id,
      websiteId: seeded.website.id,
    });
    expect(again.kind).toBe("skipped");
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failureCount).toBe(1);
  });

  it("ignores an older check that finishes after a newer one", async () => {
    const seeded = await seedMonitor("Out Of Order", 1);
    const newer = nextWindow();
    const older = {
      startedAt: new Date(newer.startedAt.getTime() - 60_000),
      finishedAt: new Date(newer.finishedAt.getTime() - 60_000),
    };
    await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
      newer,
    );
    const stale = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
      older,
    );
    expect(stale.outcome.kind).toBe("skipped");
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(0);
    const monitor = await database.monitor.findUnique({
      where: { id: seeded.monitor.id },
    });
    expect(monitor?.consecutiveFailures).toBe(0);
  });

  it("opens and resolves through the worker job path", async () => {
    const seeded = await seedMonitor("Worker Path", 2);
    const failTransport = async () => ({
      statusCode: 500,
      headers: {},
    });
    await executeMonitorJob(seeded.monitor.id, {
      resolver: publicResolver,
      transport: failTransport,
    });
    await executeMonitorJob(seeded.monitor.id, {
      resolver: publicResolver,
      transport: failTransport,
    });
    expect(await incidentsFor(seeded.monitor.id)).toHaveLength(1);
    await executeMonitorJob(seeded.monitor.id, {
      resolver: publicResolver,
      transport: async () => ({ statusCode: 200, headers: {} }),
    });
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows[0]?.status).toBe("RESOLVED");
  });

  it("opens and resolves incidents for consecutive SOFT_404 checks", async () => {
    const seeded = await seedMonitor("Soft 404 Incident");
    const first = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 200,
        errorType: "SOFT_404",
        errorMessage:
          "The page appears to be a not-found page despite returning HTTP 200.",
        soft404Score: 92,
        soft404ClassifierVersion: "v1",
        soft404Signals: ["TITLE_NOT_FOUND", "H1_NOT_FOUND"],
      }),
    );
    const second = await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 200,
        errorType: "SOFT_404",
        errorMessage:
          "The page appears to be a not-found page despite returning HTTP 200.",
        soft404Score: 92,
        soft404ClassifierVersion: "v1",
        soft404Signals: ["TITLE_NOT_FOUND", "H1_NOT_FOUND"],
      }),
    );
    expect(first.outcome.kind).toBe("none");
    expect(second.outcome.kind).toBe("opened");
    const opened = await incidentsFor(seeded.monitor.id);
    expect(opened[0]?.initialErrorType).toBe("SOFT_404");
    expect(opened[0]?.latestHttpStatus).toBe(200);
    expect(
      await database.notificationOutboxEvent.findMany({
        where: {
          aggregateId: opened[0]?.id,
          eventType: "INCIDENT_OPENED",
        },
      }),
    ).toHaveLength(1);

    const recovered = await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    expect(recovered.outcome.kind).toBe("resolved");
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows[0]?.status).toBe("RESOLVED");
    expect(
      await database.notificationOutboxEvent.count({
        where: {
          aggregateId: rows[0]?.id,
          eventType: "INCIDENT_RESOLVED",
        },
      }),
    ).toBe(1);

    const stored = await database.monitorCheck.findUnique({
      where: { id: second.checkId },
    });
    expect(stored?.soft404Score).toBe(92);
    expect(stored?.soft404ClassifierVersion).toBe("v1");
  });

  it("keeps incident history when a monitor is archived", async () => {
    const seeded = await seedMonitor("Archive History", 1);
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 404,
        errorType: "HTTP_404",
      }),
    );
    await deleteMonitor({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      websiteId: seeded.website.id,
      monitorId: seeded.monitor.id,
    });
    const rows = await incidentsFor(seeded.monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("OPEN");
  });
});

describe("incident tenant isolation", () => {
  it("blocks organization B from reading organization A incidents", async () => {
    const seeded = await seedMonitor("Tenant A", 1);
    await applyCheck(
      seeded,
      checkResult({
        status: "FAILURE",
        httpStatus: 500,
        errorType: "HTTP_5XX",
      }),
    );
    const incident = (await incidentsFor(seeded.monitor.id))[0];
    expect(incident).toBeTruthy();

    const other = await createTestOwner("Tenant B");
    userIds.push(other.user.id);
    organizationIds.push(other.organization.id);

    await expect(
      getOrganizationIncident(
        other.user.id,
        other.organization.slug,
        incident!.id,
      ),
    ).rejects.toBeInstanceOf(IncidentNotFoundError);

    const listed = await listOrganizationIncidents(
      other.user.id,
      other.organization.slug,
      "all",
    );
    expect(listed).toHaveLength(0);

    const outsider = await createTestUser("Outsider");
    userIds.push(outsider.id);
    await expect(
      listOrganizationIncidents(outsider.id, seeded.organization.slug, "open"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
