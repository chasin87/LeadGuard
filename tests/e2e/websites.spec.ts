import { expect, test } from "@playwright/test";

function uniqueEmail(prefix: string) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return `${safePrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const password = "CorrectHorse1";
const websiteDetailUrl = /\/app\/[^/]+\/websites\/(?!new(?:\/|$))[^/]+$/;

async function addWebsite(
  page: import("@playwright/test").Page,
  name: string,
  url: string,
) {
  await page.getByLabel("Website name").fill(name);
  await page.getByLabel("Website URL").fill(url);
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name })).toBeVisible();
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

test("happy path: add, edit, disable, enable, and delete a website", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Website Owner", "Website Company");

  await expect(
    page.getByRole("heading", { name: "No websites yet" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Websites" }).click();
  await expect(page.getByRole("heading", { name: "Websites" })).toBeVisible();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await addWebsite(page, "Example", "example.com");
  await expect(page.getByText("https://example.com")).toBeVisible();
  await expect(page.getByText("Active").first()).toBeVisible();
  await expect(page.getByText("No monitors yet")).toBeVisible();

  await page.getByRole("link", { name: "Website settings" }).click();
  await page.getByLabel("Website name").fill("Example Updated");
  await page.getByLabel("Status").selectOption("DISABLED");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled({
    timeout: 20_000,
  });

  await page.getByRole("link", { name: "Websites" }).click();
  await expect(
    page.getByRole("heading", { name: "Example Updated" }),
  ).toBeVisible();
  await expect(page.getByText("Disabled").first()).toBeVisible();
  await page.getByRole("link", { name: "View website" }).click();
  await expect(page.getByText("Disabled").first()).toBeVisible();
  await page.getByRole("button", { name: "Enable" }).click();
  await expect(page.getByText("Active").first()).toBeVisible();
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Disabled").first()).toBeVisible();

  await page.getByRole("link", { name: "Website settings" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete website" }).click();
  await expect(page).toHaveURL(/\/app\/.+\/websites$/);
  await expect(
    page.getByRole("heading", { name: "No websites yet" }),
  ).toBeVisible();
});

test("user A cannot open organization B's website by ID", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const tenantA = await registerOrganization(
    pageA,
    "Alice Web",
    "Organization Alpha Web",
  );
  const orgASlug = new URL(tenantA.organizationUrl).pathname.split("/")[2];
  if (!orgASlug) {
    throw new Error("Kon de organisatie-slug van tenant A niet bepalen.");
  }

  await pageA.goto(`/app/${orgASlug}/websites/new`);
  await addWebsite(pageA, "Alpha Public Site", "example.com");
  const websiteAUrl = pageA.url();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const tenantB = await registerOrganization(
    pageB,
    "Bob Web",
    "Organization Beta Web",
  );
  const orgBSlug = new URL(tenantB.organizationUrl).pathname.split("/")[2];
  if (!orgBSlug) {
    throw new Error("Kon de organisatie-slug van tenant B niet bepalen.");
  }

  await pageB.goto(`/app/${orgBSlug}/websites/new`);
  await addWebsite(pageB, "Secret Beta Site", "www.example.com");
  const websiteBId = new URL(pageB.url()).pathname.split("/").at(-1);
  if (!websiteBId) {
    throw new Error("Kon het website-id van tenant B niet bepalen.");
  }

  await pageB.goto(websiteAUrl);
  await expect(
    pageB.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(pageB.getByText("403")).toBeVisible();
  await expect(pageB.getByText("Alpha Public Site")).toHaveCount(0);

  await pageA.goto(`/app/${orgASlug}/websites/${websiteBId}`);
  await expect(
    pageA.getByRole("heading", { name: "Website not found" }),
  ).toBeVisible();
  await expect(pageA.getByText("Secret Beta Site")).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
