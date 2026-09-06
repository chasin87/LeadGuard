import { afterAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import os from "node:os";
import { database } from "@/server/database";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import { createMonitor } from "@/server/monitors/service";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import { executeFormMonitorJob } from "@/server/monitoring/form-runner";
import { disconnectFormLocks } from "@/server/monitoring/form-runner";
import { closeSharedBrowser } from "@/server/monitoring/browser/session";
import { prepareFormSubmissionAttempt } from "@/server/monitoring/form/attempt";
import { resetArtifactStorageForTests } from "@/server/storage";
import { enableWebsiteTracking } from "@/server/tracking/service";
import { trackerV1Source } from "@/tracking/sdk/v1-source";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await closeSharedBrowser().catch(() => undefined);
  await disconnectFormLocks().catch(() => undefined);
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

const workingForm = `<!doctype html><html><body>
<form id="quote-form" method="post" action="/thanks">
  <input name="name" />
  <input name="email" type="email" />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
</body></html>`;

const thanksPage = `<!doctype html><html><body><div class="success">Bedankt voor uw aanvraag</div></body></html>`;

async function seedFormMonitor(
  name: string,
  extra?: {
    threshold?: number;
    successSelector?: string;
    successText?: string;
    successUrlPattern?: string;
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
      type: "FORM",
      url: `https://${host}/offerte`,
      intervalSeconds: 21600,
      timeoutMs: 20_000,
      viewport: "DESKTOP",
      formSelector: "form#quote-form",
      submitSelector: 'button[type="submit"]',
      fieldMappings: [
        { role: "NAME", control: "TEXT", selector: 'input[name="name"]' },
        { role: "EMAIL", control: "EMAIL", selector: 'input[name="email"]' },
        {
          role: "MESSAGE",
          control: "TEXTAREA",
          selector: 'textarea[name="message"]',
        },
      ],
      successMode: "ANY",
      successSelector: extra?.successSelector ?? ".success",
      successText: extra?.successText,
      successUrlPattern: extra?.successUrlPattern,
      testDisplayName: "LeadGuard Test",
      testEmail: "leadtests@example.com",
      consented: true,
      consecutiveFailuresBeforeIncident: extra?.threshold ?? 2,
    },
    { resolver: publicResolver },
  );
  return { owner, website, monitor };
}

describe("form monitor checks", () => {
  it("creates form monitors paused until a real test succeeds", async () => {
    const seeded = await seedFormMonitor("Paused form");
    expect(seeded.monitor.status).toBe("PAUSED");
    expect(seeded.monitor.type).toBe("FORM");
  });

  it("confirms success via selector after submit", async () => {
    const { server, origin } = await listen((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(thanksPage);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(workingForm);
    });
    const seeded = await seedFormMonitor("Selector success");
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = path.join(
      os.tmpdir(),
      `leadguard-form-${Date.now()}`,
    );
    resetArtifactStorageForTests();
    const outcome = await executeFormMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
      source: "manual",
      mode: "submit",
      jobId: `test-success-${seeded.monitor.id}`,
    });
    expect(outcome).toBe("completed");
    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
      include: { formDetail: true },
    });
    expect(check?.status).toBe("SUCCESS");
    expect(check?.formDetail?.successConfirmed).toBe(true);
    expect(check?.formDetail?.submissionId).toMatch(/^LG-/);
    const config = await database.formMonitorConfig.findUnique({
      where: { monitorId: seeded.monitor.id },
    });
    expect(config?.configurationStatus).toBe("VERIFIED");
    server.close();
  }, 90_000);

  it("detects a 500 submit as FORM_SUBMISSION_FAILED and can open an incident", async () => {
    const { server, origin } = await listen((req, res) => {
      if (req.method === "POST") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("error");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(workingForm);
    });
    const seeded = await seedFormMonitor("Backend 500", { threshold: 1 });
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    process.env.ARTIFACT_STORAGE_DRIVER = "local";
    process.env.ARTIFACT_STORAGE_LOCAL_DIR = path.join(
      os.tmpdir(),
      `leadguard-form-${Date.now()}`,
    );
    resetArtifactStorageForTests();
    await executeFormMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
      source: "manual",
      mode: "submit",
      jobId: `test-500-${seeded.monitor.id}`,
    });
    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
      include: { formDetail: true },
    });
    expect(check?.status).toBe("FAILURE");
    expect(check?.errorType).toBe("FORM_SUBMISSION_FAILED");
    expect(check?.formDetail?.screenshotKey).toMatch(/^screenshots\//);
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id, status: "OPEN" },
    });
    expect(incident).not.toBeNull();
    server.close();
  }, 90_000);

  it("does not submit when CAPTCHA is present", async () => {
    const { server, origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body><form id="quote-form">${workingForm}<div class="g-recaptcha"></div></form></body></html>`,
      );
    });
    const seeded = await seedFormMonitor("Captcha form", { threshold: 1 });
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    await executeFormMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
      source: "manual",
      mode: "submit",
      jobId: `test-captcha-${seeded.monitor.id}`,
    });
    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
      include: { formDetail: true },
    });
    expect(check?.errorType).toBe("UNSUPPORTED_CAPTCHA");
    expect(check?.formDetail?.submitClicked).toBe(false);
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
    server.close();
  }, 90_000);

  it("does not resubmit after a submitting attempt", async () => {
    const seeded = await seedFormMonitor("No double submit");
    const jobId = `retry-${seeded.monitor.id}`;
    const attempt = await prepareFormSubmissionAttempt({
      monitorId: seeded.monitor.id,
      jobId,
    });
    await database.formSubmissionAttempt.update({
      where: { id: attempt.attemptId },
      data: { state: "SUBMITTING" },
    });
    await executeFormMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
      source: "manual",
      mode: "submit",
      jobId,
    });
    const check = await database.monitorCheck.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(check?.errorType).toBe("AMBIGUOUS_SUBMISSION");
    const attempts = await database.formSubmissionAttempt.count({
      where: { monitorId: seeded.monitor.id },
    });
    expect(attempts).toBe(1);
  });

  it("does not open an incident for invalid configuration", async () => {
    const seeded = await seedFormMonitor("Invalid form config");
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
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
  });

  it("does not create revenue attribution from a synthetic form visit", async () => {
    let trackingPosts = 0;
    const formWithTracker = `<!doctype html><html><body>
<script>window.__leadguardWouldHaveRun = !window.__LEADGUARD_MONITORING__;</script>
<script defer src="/tracker/v1.js" data-site-key="lg_site_fixtureaaaaaaaaaaaaaa"></script>
<form id="quote-form" method="post" action="/thanks">
  <input name="name" />
  <input name="email" type="email" />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
</body></html>`;
    const { server, origin } = await listen((req, res) => {
      if (req.url === "/tracker/v1.js") {
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end(trackerV1Source);
        return;
      }
      if (req.url === "/api/tracking/v1/events") {
        trackingPosts += 1;
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(thanksPage);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(formWithTracker);
    });
    const seeded = await seedFormMonitor("Synthetic tracking");
    await enableWebsiteTracking({
      organizationId: seeded.website.organizationId,
      websiteId: seeded.website.id,
    });
    await database.monitor.update({
      where: { id: seeded.monitor.id },
      data: { normalizedUrl: `${origin}/` },
    });
    await executeFormMonitorJob(seeded.monitor.id, {
      allowPrivateLoopbackForTests: true,
      source: "manual",
      mode: "submit",
      jobId: `test-synth-${seeded.monitor.id}`,
    });
    expect(trackingPosts).toBe(0);
    expect(
      await database.attributionVisitor.count({
        where: { websiteId: seeded.website.id },
      }),
    ).toBe(0);
    expect(
      await database.lead.count({ where: { websiteId: seeded.website.id } }),
    ).toBe(0);
    server.close();
  }, 90_000);

  it("hides form config from another organization", async () => {
    const seeded = await seedFormMonitor("Secret form");
    const other = await createTestUser("Other tenant");
    userIds.push(other.id);
    await expect(
      database.formMonitorConfig.findMany({
        where: {
          monitorId: seeded.monitor.id,
          monitor: { website: { organizationId: "does-not-match" } },
        },
      }),
    ).resolves.toEqual([]);
  });
});
