import {
  expect,
  test as base,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

declare global {
  interface Window {
    LeadGuard?: {
      ready?: () => Promise<void>;
      setConsent: (value: { attribution: string }) => void;
      getAttributionToken: () => string | null;
      trackLead: (options?: {
        eventId?: string;
        externalLeadId?: string;
      }) => void;
    };
  }
}

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "../..");
export const password = "CorrectHorse1";
export const websiteDetailUrl = /\/app\/[^/]+\/websites\/(?!new(?:\/|$))[^/]+$/;
export const monitorDetailUrl =
  /\/app\/[^/]+\/websites\/[^/]+\/monitors\/(?!new(?:\/|$))[^/]+$/;

export function e2eRunId(): string {
  return process.env.E2E_RUN_ID ?? "local";
}

export function e2eHeaders(testInfo: Pick<TestInfo, "workerIndex">) {
  return {
    "X-LeadGuard-Test-Run-Id": e2eRunId(),
    "X-LeadGuard-Test-Worker-Id": String(testInfo.workerIndex),
  };
}

export const test = base.extend({
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    await provide(e2eHeaders(testInfo));
  },
});

export { expect };

export function uniqueEmail(
  prefix: string,
  testInfo?: Pick<TestInfo, "workerIndex">,
) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const runId = e2eRunId()
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 12);
  const worker = testInfo?.workerIndex ?? 0;
  const id = crypto.randomUUID();
  return `e2e+${runId}-${worker}-${safePrefix}-${id}@example.test`;
}

export function uniqueId(prefix: string) {
  return `${prefix}-${e2eRunId().slice(0, 8)}-${crypto.randomUUID()}`;
}

export async function openIsolatedPage(
  browser: Browser,
  testInfo: Pick<TestInfo, "workerIndex">,
) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eHeaders(testInfo),
  });
  const page = await context.newPage();
  return { context, page };
}

export async function registerOrganization(
  page: Page,
  name: string,
  organizationName: string,
  testInfo?: Pick<TestInfo, "workerIndex">,
) {
  const email = uniqueEmail(name, testInfo);
  await page.goto("/register");
  await page.getByLabel("Naam").fill(name);
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await expect(
    page.getByRole("heading", { name: "Maak je organisatie" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Bedrijfsnaam").fill(organizationName);
  await page.getByRole("button", { name: "Organisatie maken" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/app\/.+\/dashboard$/);
  return { email, organizationUrl: page.url() };
}

export async function runApplyScript(script: string, args: string[]) {
  const { stdout } = await execFileAsync("npx", ["tsx", script, ...args], {
    cwd: repoRoot,
    env: process.env,
    timeout: 60_000,
  });
  return stdout.trim();
}

export function parseApplyLeadIds(stdout: string): string[] {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(/^E2E_LEAD_IDS=([a-z0-9,]+)$/i);
    if (match?.[1]) {
      return match[1].split(",").filter(Boolean);
    }
  }
  throw new Error("Apply script did not print E2E_LEAD_IDS.");
}

export async function waitForLeadGuard(page: Page) {
  await page.waitForFunction(() => Boolean(window.LeadGuard));
  await page.evaluate(async () => {
    await window.LeadGuard?.ready?.();
  });
}

export async function grantTrackingConsent(page: Page) {
  await waitForLeadGuard(page);
  const pending = page.waitForResponse(
    (response) =>
      response.url().includes("/api/tracking/v1/events") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.evaluate(() => {
    window.LeadGuard?.setConsent({ attribution: "granted" });
  });
  await pending;
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies();
      return cookies.some((cookie) => cookie.name === "_lg_vid");
    })
    .toBe(true);
}

export async function trackLead(
  page: Page,
  options?: { eventId?: string; externalLeadId?: string },
) {
  await waitForLeadGuard(page);
  const pending = page.waitForResponse(
    (response) =>
      response.url().includes("/api/tracking/v1/events") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.evaluate((payload) => {
    window.LeadGuard?.trackLead(payload);
  }, options ?? {});
  await pending;
}

export async function installCustomerSite(
  page: Page,
  siteKey: string,
  appOrigin: string,
) {
  await page.route("https://example.com/**", async (route) => {
    if (route.request().isNavigationRequest() === false) {
      const requestUrl = new URL(route.request().url());
      if (
        requestUrl.pathname === "/tracker/v1.js" ||
        requestUrl.pathname.startsWith("/api/tracking/")
      ) {
        const method = route.request().method();
        const proxied = await page.request.fetch(
          `${appOrigin}${requestUrl.pathname}${requestUrl.search}`,
          {
            method,
            headers: {
              ...route.request().headers(),
              origin: "https://example.com",
            },
            ...(method === "GET" || method === "HEAD"
              ? {}
              : { data: route.request().postDataBuffer() ?? undefined }),
          },
        );
        await route.fulfill({
          status: proxied.status(),
          headers: {
            ...proxied.headers(),
            "access-control-allow-origin": "https://example.com",
          },
          body: await proxied.body(),
        });
        return;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body>
<script defer src="https://example.com/tracker/v1.js" data-site-key="${siteKey}"></script>
<form id="offerte-formulier"></form>
</body></html>`,
    });
  });
}

export async function visitCustomer(page: Page, search: string) {
  await page.goto(`https://example.com/${search}`);
  await waitForLeadGuard(page);
}
