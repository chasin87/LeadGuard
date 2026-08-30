import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const password = "CorrectHorse1";

function uniqueEmail(prefix: string) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return `${safePrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
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

test("fake Google Ads connect, sync, approval, incident context, and disconnect", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await registerOrganization(page, "Ads Owner", "Ads Company");
  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example NL");
  await page.getByLabel("Website URL").fill("example.nl");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(/\/websites\/(?!new)/, { timeout: 20_000 });

  await page.getByRole("link", { name: "Integrations" }).click();
  await expect(page.getByRole("heading", { name: "Google Ads" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Connect Google Ads" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect LeadGuard to Google Ads" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Approve and continue" }).click();
  await expect(page).toHaveURL(/\/integrations\/google-ads$/, {
    timeout: 20_000,
  });
  await expect(page.getByText("Connected")).toBeVisible();
  await page.getByLabel(/Voltios Energie/).check();
  await page.getByRole("button", { name: "Save accounts and sync" }).click();
  await expect(page.getByText("Google Ads scan complete")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("link", { name: "https://example.nl/airco", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Google Ads discovered a new destination domain"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve website" }).click();
  await expect(
    page.getByText("Google Ads discovered a new destination domain"),
  ).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("Needs approval", { exact: true })).toHaveCount(
    0,
  );

  await page
    .getByRole("link", { name: "https://example.nl/airco", exact: true })
    .click();
  await expect(page.getByText("Google Ads sources")).toBeVisible();
  await expect(
    page.getByText("Campaign Airco Amsterdam").first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "View monitor" }).click();
  await expect(page.getByText("Ad destination", { exact: true })).toBeVisible();
  const monitorUrl = page.url();
  const monitorId = monitorUrl.split("/monitors/")[1]?.split("/")[0];
  expect(monitorId).toBeTruthy();

  await execFileAsync("npx", [
    "tsx",
    "--env-file=.env",
    "tests/e2e/apply-monitor-check.ts",
    monitorId!,
    "FAILURE",
  ]);
  await execFileAsync("npx", [
    "tsx",
    "--env-file=.env",
    "tests/e2e/apply-monitor-check.ts",
    monitorId!,
    "FAILURE",
  ]);
  await page.goto(monitorUrl);
  await page.getByRole("link", { name: "View open incident" }).click();
  await expect(
    page.getByRole("heading", { name: "Google Ads impact" }),
  ).toBeVisible();
  await expect(page.getByText(/Enabled ad references/)).toBeVisible();
  const incidentUrl = page.url();
  const incidentId = incidentUrl.split("/incidents/")[1]?.split("/")[0];
  expect(incidentId).toBeTruthy();
  await execFileAsync("npx", [
    "tsx",
    "--env-file=.env",
    "tests/e2e/apply-ads-impact.ts",
    incidentId!,
    "hourly",
  ]);
  await page.goto(incidentUrl);
  await expect(page.getByText("€135.00")).toBeVisible();
  await expect(
    page.getByText(/Partial spend attribution|Estimated spend at risk/),
  ).toBeVisible();
  await expect(
    page.getByText(/Destination spend on incident date/),
  ).toBeVisible();
  await expect(page.getByText("Exact incident-window spend")).toHaveCount(0);

  await execFileAsync("npx", [
    "tsx",
    "--env-file=.env",
    "tests/e2e/apply-ads-impact.ts",
    incidentId!,
    "daily",
  ]);
  await page.goto(incidentUrl);
  await expect(
    page.getByText(/Destination spend on incident date/),
  ).toBeVisible();
  await expect(page.getByText("€240.00")).toBeVisible();
  await expect(page.getByText("Spend during monitored outage")).toHaveCount(0);
  await expect(page.getByText("€135.00")).toHaveCount(0);

  await execFileAsync("npx", [
    "tsx",
    "--env-file=.env",
    "tests/e2e/apply-ads-impact.ts",
    incidentId!,
    "none",
  ]);
  await page.goto(incidentUrl);
  await expect(page.getByText("Impact data unavailable")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Ad destination/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Integrations" }).click();
  await page.getByRole("button", { name: "Disconnect Google Ads" }).click();
  await expect(page.getByText("Disconnected")).toBeVisible({ timeout: 15_000 });
  await page.goto(monitorUrl);
  await expect(page.getByText("Ad destination", { exact: true })).toBeVisible();
});
