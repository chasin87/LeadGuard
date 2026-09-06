import {
  expect,
  openIsolatedPage,
  registerOrganization,
  test,
  websiteDetailUrl,
} from "./fixtures";

async function addWebsite(page: import("@playwright/test").Page, name: string) {
  await page.getByLabel("Website name").fill(name);
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("happy path: add, edit, disable, enable, and delete a website", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(
    page,
    "Website Owner",
    "Website Company",
    testInfo,
  );

  await expect(
    page.getByRole("heading", { name: "No websites yet" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Websites" }).click();
  await expect(page.getByRole("heading", { name: "Websites" })).toBeVisible();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await addWebsite(page, "Example");
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
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByText("Active").first()).toBeVisible();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
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
}, testInfo) => {
  test.setTimeout(120_000);
  const tenantA = await openIsolatedPage(browser, testInfo);
  const createdA = await registerOrganization(
    tenantA.page,
    "Alice Web",
    "Organization Alpha Web",
    testInfo,
  );
  const orgASlug = new URL(createdA.organizationUrl).pathname.split("/")[2];
  if (!orgASlug) {
    throw new Error("Kon de organisatie-slug van tenant A niet bepalen.");
  }

  await tenantA.page.goto(`/app/${orgASlug}/websites/new`);
  await addWebsite(tenantA.page, "Alpha Public Site");
  const websiteAUrl = tenantA.page.url();

  const tenantB = await openIsolatedPage(browser, testInfo);
  const createdB = await registerOrganization(
    tenantB.page,
    "Bob Web",
    "Organization Beta Web",
    testInfo,
  );
  const orgBSlug = new URL(createdB.organizationUrl).pathname.split("/")[2];
  if (!orgBSlug) {
    throw new Error("Kon de organisatie-slug van tenant B niet bepalen.");
  }

  await tenantB.page.goto(`/app/${orgBSlug}/websites/new`);
  await addWebsite(tenantB.page, "Secret Beta Site");
  const websiteBId = new URL(tenantB.page.url()).pathname.split("/").at(-1);
  if (!websiteBId) {
    throw new Error("Kon het website-id van tenant B niet bepalen.");
  }

  await tenantB.page.goto(websiteAUrl);
  await expect(
    tenantB.page.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(tenantB.page.getByText("403")).toBeVisible();
  await expect(tenantB.page.getByText("Alpha Public Site")).toHaveCount(0);

  await tenantA.page.goto(`/app/${orgASlug}/websites/${websiteBId}`);
  await expect(
    tenantA.page.getByRole("heading", { name: "Website not found" }),
  ).toBeVisible();
  await expect(tenantA.page.getByText("Secret Beta Site")).toHaveCount(0);

  await tenantA.context.close();
  await tenantB.context.close();
});
