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

async function applyReceipt(
  monitorId: string,
  mode: "pending" | "received" | "timeout",
) {
  const { stdout } = await execFileAsync(
    "npx",
    ["tsx", "--env-file=.env", "tests/e2e/apply-receipt.ts", monitorId, mode],
    { cwd: repoRoot },
  );
  return stdout.trim();
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

test("owner can enable webhook receipt verification and confirm a receipt", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await registerOrganization(page, "Receipt Owner", "Receipt Company");
  await createFormMonitor(page);
  await page.getByRole("link", { name: "Monitor settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Lead receipt verification" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Webhook" }).check();
  await page.getByRole("button", { name: "Save receipt settings" }).click();
  await expect(page.getByText(/Store this signing secret now/)).toBeVisible();
  await expect(page.getByText(/api\/receipts\/webhook/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable scheduled tests" }),
  ).toHaveCount(0);

  const monitorId = page.url().split("/monitors/")[1]?.split(/[/?#]/)[0];
  expect(monitorId).toBeTruthy();
  await applyReceipt(monitorId!, "received");
  await page.goto(page.url().replace(/\/settings$/, ""));
  await expect(page.getByText("Confirmed").first()).toBeVisible();
  await expect(page.getByText("Lead received").first()).toBeVisible();
});

test("receipt timeout is visible without rewriting form submission success", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await registerOrganization(page, "Receipt Timeout", "Receipt Timeout Co");
  await createFormMonitor(page);
  await page.getByRole("link", { name: "Monitor settings" }).click();
  await page.getByRole("radio", { name: "Webhook" }).check();
  await page.getByRole("button", { name: "Save receipt settings" }).click();
  await expect(page.getByText(/Store this signing secret now/)).toBeVisible();
  const monitorId = page.url().split("/monitors/")[1]?.split(/[/?#]/)[0];
  expect(monitorId).toBeTruthy();
  await applyReceipt(monitorId!, "timeout");
  await page.goto(page.url().replace(/\/settings$/, ""));
  await expect(
    page.getByText("Lead delivery could not be confirmed").first(),
  ).toBeVisible();
  await expect(page.getByText("Receipt timeout").first()).toBeVisible();
  await expect(page.getByText("Submission confirmed").first()).toBeVisible();
});

test("another organization cannot see receipt secrets", async ({ browser }) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await registerOrganization(pageA, "Receipt Alice", "Receipt Alpha");
  await createFormMonitor(pageA);
  await pageA.getByRole("link", { name: "Monitor settings" }).click();
  await pageA.getByRole("radio", { name: "Webhook" }).check();
  await pageA.getByRole("button", { name: "Save receipt settings" }).click();
  await expect(pageA.getByText(/Store this signing secret now/)).toBeVisible();
  const secretUrl = pageA.url();
  const secretText = await pageA.locator("code").allTextContents();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await registerOrganization(pageB, "Receipt Bob", "Receipt Beta");
  await pageB.goto(secretUrl);
  await expect(
    pageB.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  for (const value of secretText) {
    if (value.startsWith("lgrw_")) {
      await expect(pageB.getByText(value)).toHaveCount(0);
    }
  }

  await contextA.close();
  await contextB.close();
});
