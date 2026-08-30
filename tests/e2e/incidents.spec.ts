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

async function applyCheck(monitorId: string, mode: "FAILURE" | "SUCCESS") {
  await execFileAsync(
    "npx",
    [
      "tsx",
      "--env-file=.env",
      "tests/e2e/apply-monitor-check.ts",
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
}

test("failure streak opens an incident and recovery resolves it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await registerOrganization(page, "Incident Owner", "Incident Company");
  await expect(
    page.getByRole("heading", { name: "Active incidents" }),
  ).toBeVisible();
  await expect(page.getByText("No open incidents.")).toBeVisible();

  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("link", { name: "Add monitor" }).click();
  await page.getByLabel("Monitor name").fill("Airco offerte");
  await page.getByLabel("URL").fill("https://example.com/offerte");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });

  const monitorId = page.url().split("/monitors/")[1]?.split(/[?#]/)[0];
  expect(monitorId).toBeTruthy();
  await applyCheck(monitorId!, "FAILURE");
  await applyCheck(monitorId!, "FAILURE");
  await page.reload();
  await expect(page.getByText("Down", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("View open incident")).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Active incidents" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Airco offerte/ })).toBeVisible();

  await page
    .getByRole("link", { name: /Incidents/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Open incidents" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Airco offerte/ })
    .first()
    .click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();

  await applyCheck(monitorId!, "SUCCESS");
  await page.reload();
  await expect(page.getByText("Resolved", { exact: true }).first()).toBeVisible(
    {
      timeout: 15_000,
    },
  );
});
