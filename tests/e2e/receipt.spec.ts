import {
  expect,
  monitorDetailUrl,
  openIsolatedPage,
  registerOrganization,
  runApplyScript,
  test,
  websiteDetailUrl,
} from "./fixtures";

async function applyReceipt(
  monitorId: string,
  mode: "pending" | "received" | "timeout",
) {
  return runApplyScript("tests/e2e/apply-receipt.ts", [monitorId, mode]);
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
    .fill("leadtests@example.test");
  await page.getByRole("checkbox", { name: /safe test lead/ }).check();
  await page.getByRole("checkbox", { name: /real test leads/ }).check();
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });
}

test("owner can enable webhook receipt verification and confirm a receipt", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Receipt Owner",
    "Receipt Company",
    testInfo,
  );
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
  await expect(page.getByText("Confirmed").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Lead received").first()).toBeVisible();
});

test("receipt timeout is visible without rewriting form submission success", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Receipt Timeout",
    "Receipt Timeout Co",
    testInfo,
  );
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
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Receipt timeout").first()).toBeVisible();
  await expect(page.getByText("Submission confirmed").first()).toBeVisible();
});

test("another organization cannot see receipt secrets", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const tenantA = await openIsolatedPage(browser, testInfo);
  await registerOrganization(
    tenantA.page,
    "Receipt Alice",
    "Receipt Alpha",
    testInfo,
  );
  await createFormMonitor(tenantA.page);
  await tenantA.page.getByRole("link", { name: "Monitor settings" }).click();
  await tenantA.page.getByRole("radio", { name: "Webhook" }).check();
  await tenantA.page
    .getByRole("button", { name: "Save receipt settings" })
    .click();
  await expect(
    tenantA.page.getByText(/Store this signing secret now/),
  ).toBeVisible();
  const secretUrl = tenantA.page.url();
  const secretText = await tenantA.page.locator("code").allTextContents();

  const tenantB = await openIsolatedPage(browser, testInfo);
  await registerOrganization(
    tenantB.page,
    "Receipt Bob",
    "Receipt Beta",
    testInfo,
  );
  await tenantB.page.goto(secretUrl);
  await expect(
    tenantB.page.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  for (const value of secretText) {
    if (value.startsWith("lgrw_")) {
      await expect(tenantB.page.getByText(value)).toHaveCount(0);
    }
  }

  await tenantA.context.close();
  await tenantB.context.close();
});
