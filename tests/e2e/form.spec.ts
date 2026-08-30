import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "../..");

function uniqueEmail(prefix: string) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return `${safePrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const password = "CorrectHorse1";
const websiteDetailUrl = /\/app\/[^/]+\/websites\/(?!new(?:\/|$))[^/]+$/;
const monitorDetailUrl =
  /\/app\/[^/]+\/websites\/[^/]+\/monitors\/(?!new(?:\/|$))[^/]+$/;

async function applyFormCheck(monitorId: string, mode: "FAILURE" | "SUCCESS") {
  await execFileAsync(
    "npx",
    [
      "tsx",
      "--env-file=.env",
      "tests/e2e/apply-form-check.ts",
      monitorId,
      mode,
    ],
    { cwd: repoRoot },
  );
}

async function registerOrganization(
  page: import("@playwright/test").Page,
  name: string,
  organizationName: string,
) {
  const email = uniqueEmail(name);
  await page.goto("/register");
  await page.getByLabel("Naam").fill(name);
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await expect(
    page.getByRole("heading", { name: "Maak je organisatie" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Bedrijfsnaam").fill(organizationName);
  await page.getByRole("button", { name: "Organisatie maken" }).click();
  await expect(page).toHaveURL(/\/app\/.+\/dashboard$/);
  return { email, organizationUrl: page.url() };
}

async function createFormMonitor(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });

  await page.getByRole("link", { name: "Add monitor" }).click();
  await page.getByRole("radio", { name: /Form Monitor/ }).check();
  await page.getByLabel("Monitor name").fill("Quote form");
  await page
    .getByRole("textbox", { name: "URL", exact: true })
    .fill("https://example.com/offerte");
  await page
    .getByRole("textbox", { name: "Form selector" })
    .fill("form#quote-form");
  await page
    .getByRole("textbox", { name: "Submit selector" })
    .fill('button[type="submit"]');
  await page
    .getByRole("textbox", { name: "Success selector" })
    .fill(".thank-you");
  await page
    .getByRole("textbox", { name: "Test email" })
    .fill("leadtests@example.com");
  await page.getByRole("checkbox", { name: /safe test lead/ }).check();
  await page.getByRole("checkbox", { name: /real test leads/ }).check();
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });
}

test("happy path: create a form monitor without enabling scheduled tests", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Form Owner", "Form Company");
  await createFormMonitor(page);
  await expect(page.getByRole("heading", { name: "Quote form" })).toBeVisible();
  await expect(page.getByText("Form monitor")).toBeVisible();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVERIFIED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable scheduled tests" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Validate configuration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send real test lead" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Validate configuration" }).click();
  await expect(page.getByText(/Configuration validation queued/)).toBeVisible({
    timeout: 15_000,
  });
});

test("form submission failures open an incident and recovery resolves it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await registerOrganization(page, "Form Incident", "Form Incident Co");
  await createFormMonitor(page);
  const monitorId = page.url().split("/monitors/")[1]?.split(/[?#]/)[0];
  expect(monitorId).toBeTruthy();

  await applyFormCheck(monitorId!, "FAILURE");
  await applyFormCheck(monitorId!, "FAILURE");
  await page.reload();
  await expect(page.getByText("Form submission failed").first()).toBeVisible();
  await expect(page.getByText("View open incident")).toBeVisible();

  await applyFormCheck(monitorId!, "SUCCESS");
  await page.reload();
  await expect(page.getByText("View open incident")).toHaveCount(0);
  await expect(page.getByText("Submission confirmed").first()).toBeVisible();
});

test("another organization cannot open a form monitor URL", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await registerOrganization(pageA, "Form Alice", "Form Alpha");
  await createFormMonitor(pageA);
  const secretUrl = pageA.url();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await registerOrganization(pageB, "Form Bob", "Form Beta");
  await pageB.goto(secretUrl);
  await expect(
    pageB.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(pageB.getByText("Quote form")).toHaveCount(0);
  await expect(
    pageB.getByRole("button", { name: "Send real test lead" }),
  ).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
