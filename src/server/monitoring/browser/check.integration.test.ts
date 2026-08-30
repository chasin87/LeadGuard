import { afterAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { database } from "@/server/database";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import { createMonitor } from "@/server/monitors/service";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import { executeBrowserMonitorJob } from "@/server/monitoring/browser-runner";
import { disconnectBrowserLocks } from "@/server/monitoring/browser-runner";
import { closeSharedBrowser } from "@/server/monitoring/browser/session";
import { LocalArtifactStorage } from "@/server/storage/local";
import { resetArtifactStorageForTests } from "@/server/storage";
import { BrowserInfrastructureError } from "@/server/monitoring/browser/errors";
import type { DnsResolver } from "@/server/security/ssrf";
import path from "node:path";
import os from "node:os";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await closeSharedBrowser().catch(() => undefined);
  await disconnectBrowserLocks().catch(() => undefined);
  await deleteTestData({ userIds, organizationIds });
});

function uniqueHost(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

async function listen(
  handler: (
    req: IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function seedBrowserMonitor(
  name: string,
  urlPath: string,
  extra?: {
    requiredSelector?: string;
    requiredElementName?: string;
    threshold?: number;
  },
) {
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
      name,
      type: "BROWSER",
      url: `https://${host}${urlPath}`,
      intervalSeconds: 600,
      timeoutMs: 20_000,
      viewport: "DESKTOP",
      requiredSelector: extra?.requiredSelector,
      requiredElementName: extra?.requiredElementName,
      consecutiveFailuresBeforeIncident: extra?.threshold ?? 2,
    },
    { resolver: publicResolver },
  );
  await database.monitor.update({
    where: { id: monitor.id },
    data: { normalizedUrl: `http://127.0.0.1/placeholder` },
  });
  return { owner, website, monitor };
}

describe("browser monitor checks", () => {
  it("detects a missing required element, stores a screenshot key, and does not write a blob", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>Welcome</h1><p>No form here.</p></body></html>");
    });
    const seeded = await seedBrowserMonitor("Missing CTA", "/", {
      requiredSelector: "#quote-cta",
      requiredElementName: "Offerte aanvragen",
    });
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });

    const tmp = path.join(os.tmpdir(), `leadguard-artifacts-${Date.now()}`);
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = tmp;
    resetArtifactStorageForTests();

    const outcome = await executeBrowserMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    expect(outcome).toBe("completed");

    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
      include: { browserDetail: true },
      orderBy: { createdAt: "desc" },
    });
    expect(check?.status).toBe("FAILURE");
    expect(check?.errorType).toBe("REQUIRED_ELEMENT_MISSING");
    expect(check?.errorMessage).toContain("Offerte aanvragen");
    expect(check?.browserDetail?.screenshotKey).toMatch(/^screenshots\//);
    expect(
      JSON.stringify(check).includes("data:image") ||
        Object.values(check ?? {}).some((value) => Buffer.isBuffer(value)),
    ).toBe(false);

    const storage = new LocalArtifactStorage(tmp);
    const stored = await storage.get(check!.browserDetail!.screenshotKey!);
    expect(stored?.body.byteLength).toBeGreaterThan(100);

    server.close();
  }, 90_000);

  it("keeps the primary check when screenshot storage fails", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><p>Still broken.</p></body></html>");
    });
    const seeded = await seedBrowserMonitor("Storage Fail", "/", {
      requiredSelector: "#missing",
      threshold: 1,
    });
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = "/proc/leadguard-cannot-write";
    resetArtifactStorageForTests();

    await executeBrowserMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
      include: { browserDetail: true },
    });
    expect(check?.status).toBe("FAILURE");
    expect(check?.errorType).toBe("REQUIRED_ELEMENT_MISSING");
    expect(check?.browserDetail?.screenshotKey).toBeNull();
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id, status: "OPEN" },
    });
    expect(incident).not.toBeNull();
    server.close();
  }, 90_000);

  it("isolates cookies between consecutive browser contexts", async () => {
    const { server, origin } = await listen((req, res) => {
      if (req.url === "/set") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "secret=A; Path=/",
        });
        res.end("<html><body>set</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><body><div id="cookie">${""}</div><script>document.getElementById("cookie").textContent = document.cookie || "empty";</script></body></html>`,
      );
    });
    const first = await seedBrowserMonitor("Cookie A", "/set");
    const second = await seedBrowserMonitor("Cookie B", "/read");
    await database.monitor.update({
      where: { id: first.monitor.id },
      data: { normalizedUrl: `${origin}/set` },
    });
    await database.monitor.update({
      where: { id: second.monitor.id },
      data: { normalizedUrl: `${origin}/read` },
    });
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = path.join(
      os.tmpdir(),
      `leadguard-artifacts-${Date.now()}`,
    );
    resetArtifactStorageForTests();

    await executeBrowserMonitorJob(first.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    await executeBrowserMonitorJob(second.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    const checkB = await database.monitorCheck.findFirst({
      where: { monitorId: second.monitor.id },
      include: { browserDetail: true },
    });
    expect(checkB?.status).toBe("SUCCESS");
    expect(checkB?.browserDetail?.renderedTextLength).toBeGreaterThan(0);
    server.close();
  }, 90_000);

  it("blocks private subresources and unsafe redirects", async () => {
    const { server, origin } = await listen((req, res) => {
      if (req.url === "/redirect-private") {
        res.writeHead(302, { location: "http://169.254.169.254/secret" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><body><img src="http://169.254.169.254/test"><p>Public page</p></body></html>`,
      );
    });
    const imagePage = await seedBrowserMonitor("Subresource", "/");
    const redirectPage = await seedBrowserMonitor(
      "Redirect",
      "/redirect-private",
    );
    await database.monitor.update({
      where: { id: imagePage.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    await database.monitor.update({
      where: { id: redirectPage.monitor.id },
      data: { normalizedUrl: `${origin}/redirect-private`, timeoutMs: 5_000 },
    });
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = path.join(
      os.tmpdir(),
      `leadguard-artifacts-${Date.now()}`,
    );
    resetArtifactStorageForTests();

    await executeBrowserMonitorJob(imagePage.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    const publicCheck = await database.monitorCheck.findFirst({
      where: { monitorId: imagePage.monitor.id },
    });
    expect(publicCheck?.status).toBe("SUCCESS");

    await executeBrowserMonitorJob(redirectPage.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    const unsafe = await database.monitorCheck.findFirst({
      where: { monitorId: redirectPage.monitor.id },
    });
    expect(unsafe?.status).toBe("FAILURE");
    expect([
      "UNSAFE_BROWSER_REQUEST",
      "BROWSER_NAVIGATION_ERROR",
      "BROWSER_TIMEOUT",
    ]).toContain(unsafe?.errorType);
    expect(unsafe?.httpStatus).not.toBe(200);
    server.close();
  }, 90_000);

  it("does not open an incident when Chromium is unavailable", async () => {
    const seeded = await seedBrowserMonitor("Infra", "/");
    await closeSharedBrowser();
    const previous = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE =
      "/tmp/leadguard-missing-chromium";
    try {
      await expect(
        executeBrowserMonitorJob(seeded.monitor.id, {
          allowPrivateLoopbackForTests: true,
        }),
      ).rejects.toBeInstanceOf(BrowserInfrastructureError);
    } finally {
      if (previous === undefined) {
        delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
      } else {
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = previous;
      }
      await closeSharedBrowser();
    }
    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(check).toBeNull();
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
  });

  it("opens and resolves a browser incident around a required element", async () => {
    let showCta = false;
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        showCta
          ? '<html><body><button id="quote-cta">Offerte</button></body></html>'
          : "<html><body><p>Missing</p></body></html>",
      );
    });
    const seeded = await seedBrowserMonitor("Incident flow", "/", {
      requiredSelector: "#quote-cta",
      requiredElementName: "Offerte aanvragen",
      threshold: 2,
    });
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = path.join(
      os.tmpdir(),
      `leadguard-artifacts-${Date.now()}`,
    );
    resetArtifactStorageForTests();

    await executeBrowserMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    await executeBrowserMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    const open = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id, status: "OPEN" },
    });
    expect(open).not.toBeNull();

    showCta = true;
    await executeBrowserMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
    });
    const resolved = await database.incident.findFirst({
      where: { id: open!.id },
    });
    expect(resolved?.status).toBe("RESOLVED");
    server.close();
  }, 120_000);

  it("does not open an incident for invalid configuration", async () => {
    const seeded = await seedBrowserMonitor("Invalid selector", "/");
    const now = new Date();
    await persistAndProcessCheck({
      monitorId: seeded.monitor.id,
      organizationId: seeded.website.organizationId,
      websiteId: seeded.website.id,
      startedAt: now,
      finishedAt: new Date(now.getTime() + 10),
      result: {
        status: "FAILURE",
        httpStatus: 200,
        responseTimeMs: 20,
        requestedUrl: seeded.monitor.normalizedUrl,
        finalUrl: seeded.monitor.normalizedUrl,
        redirectCount: 0,
        resolvedIp: "93.184.216.34",
        errorType: "INVALID_MONITOR_CONFIGURATION",
        errorMessage: "Monitor configuration is invalid.",
      },
    });
    const monitor = await database.monitor.findFirst({
      where: { id: seeded.monitor.id },
    });
    expect(monitor?.consecutiveFailures).toBe(0);
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
  });

  it("keeps HTTP and Browser monitors on the same URL", async () => {
    const owner = await createTestOwner("Both types");
    userIds.push(owner.user.id);
    organizationIds.push(owner.organization.id);
    const host = uniqueHost("both-types");
    const website = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Both",
        url: host,
      },
      { resolver: publicResolver },
    );
    await createMonitor(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
        name: "HTTP home",
        type: "HTTP",
        url: `https://${host}/`,
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      { resolver: publicResolver },
    );
    const browser = await createMonitor(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
        name: "Browser home",
        type: "BROWSER",
        url: `https://${host}/`,
        intervalSeconds: 600,
        timeoutMs: 20_000,
        viewport: "MOBILE",
      },
      { resolver: publicResolver },
    );
    expect(browser.type).toBe("BROWSER");
  });

  it("hides browser checks from another organization", async () => {
    const seeded = await seedBrowserMonitor("Secret browser", "/");
    const other = await createTestUser("Other tenant");
    userIds.push(other.id);
    await expect(
      database.monitorCheck.findMany({
        where: {
          monitorId: seeded.monitor.id,
          monitor: {
            website: { organizationId: "does-not-match" },
          },
        },
      }),
    ).resolves.toEqual([]);
  });
});
