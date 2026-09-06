import {
  expect,
  monitorDetailUrl,
  openIsolatedPage,
  registerOrganization,
  runApplyScript,
  test,
  websiteDetailUrl,
} from "./fixtures";

async function applyFormCheck(monitorId: string, mode: "FAILURE" | "SUCCESS") {
  await runApplyScript("tests/e2e/apply-form-check.ts", [monitorId, mode]);
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

test("happy path: create a form monitor without enabling scheduled tests", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Form Owner", "Form Company", testInfo);
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
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Form Incident",
    "Form Incident Co",
    testInfo,
  );
  await createFormMonitor(page);
  const monitorId = page.url().split("/monitors/")[1]?.split(/[?#]/)[0];
  expect(monitorId).toBeTruthy();

  await applyFormCheck(monitorId!, "FAILURE");
  await applyFormCheck(monitorId!, "FAILURE");
  await page.reload();
  await expect(page.getByText("Form submission failed").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("View open incident")).toBeVisible();

  await applyFormCheck(monitorId!, "SUCCESS");
  await page.reload();
  await expect(page.getByText("View open incident")).toHaveCount(0);
  await expect(page.getByText("Submission confirmed").first()).toBeVisible();
});

test("another organization cannot open a form monitor URL", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const tenantA = await openIsolatedPage(browser, testInfo);
  await registerOrganization(
    tenantA.page,
    "Form Alice",
    "Form Alpha",
    testInfo,
  );
  await createFormMonitor(tenantA.page);
  const secretUrl = tenantA.page.url();

  const tenantB = await openIsolatedPage(browser, testInfo);
  await registerOrganization(tenantB.page, "Form Bob", "Form Beta", testInfo);
  await tenantB.page.goto(secretUrl);
  await expect(
    tenantB.page.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(tenantB.page.getByText("Quote form")).toHaveCount(0);
  await expect(
    tenantB.page.getByRole("button", { name: "Send real test lead" }),
  ).toHaveCount(0);

  await tenantA.context.close();
  await tenantB.context.close();
});
