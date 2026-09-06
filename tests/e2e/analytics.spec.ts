import type { Page } from "@playwright/test";
import {
  expect,
  grantTrackingConsent,
  installCustomerSite,
  parseApplyLeadIds,
  registerOrganization,
  runApplyScript,
  test,
  trackLead,
  uniqueId,
  visitCustomer,
  websiteDetailUrl,
} from "./fixtures";

async function connectAdsAndEnableAnalytics(page: Page) {
  await page.getByTestId("nav-integrations").click();
  await page.getByTestId("integration-google-ads").click();
  await page.getByRole("button", { name: "Connect Google Ads" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect LeadGuard to Google Ads" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Approve and continue" }).click();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/Voltios Energie/).check();
  await page.getByRole("button", { name: "Save accounts and sync" }).click();
  await expect(page.getByText("Google Ads scan complete")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Analytics mapping" }).click();
  await page.getByRole("button", { name: "Enable revenue analytics" }).click();
  await expect(page.getByText("ACTIVE")).toBeVisible({ timeout: 15_000 });
}

async function createAttributedLeads(
  page: Page,
  siteKey: string,
  appOrigin: string,
  count: number,
  clickParam: "gclid" | "wbraid",
) {
  await installCustomerSite(page, siteKey, appOrigin);
  for (let index = 0; index < count; index += 1) {
    await visitCustomer(page, `?${clickParam}=${uniqueId(clickParam)}`);
    await grantTrackingConsent(page);
    await trackLead(page, { eventId: crypto.randomUUID() });
  }
}

test("complete Real ROAS uses acquisition cohort spend and LeadGuard revenue", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await registerOrganization(
    page,
    "Analytics Owner",
    "Analytics Company",
    testInfo,
  );
  await page.getByRole("link", { name: "Websites", exact: true }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example NL");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("button", { name: "Enable tracking" }).click();
  await expect(page.getByText("Install snippet")).toBeVisible({
    timeout: 20_000,
  });
  const snippet = await page.getByTestId("tracking-snippet").textContent();
  const siteKey = snippet?.match(/data-site-key="([^"]+)"/)?.[1];
  expect(siteKey).toBeTruthy();
  const appOrigin = new URL(page.url()).origin;
  const organizationSlug = page.url().split("/app/")[1]?.split("/")[0];
  expect(organizationSlug).toBeTruthy();

  await connectAdsAndEnableAnalytics(page);
  await createAttributedLeads(page, siteKey!, appOrigin, 3, "gclid");
  await runApplyScript("tests/e2e/apply-revenue-analytics.ts", [
    organizationSlug!,
    "complete",
  ]);
  await page.goto(`/app/${organizationSlug}/analytics/revenue`);
  await expect(page.getByTestId("kpi-leads")).toContainText("3");
  await expect(page.getByTestId("kpi-won")).toContainText("2");
  await expect(page.getByTestId("kpi-revenue")).toContainText("5,000.00");
  await expect(page.getByTestId("kpi-cpl")).toContainText("333.33");
  await expect(page.getByTestId("kpi-cpw")).toContainText("500.00");
  await expect(page.getByTestId("kpi-roas")).toContainText("Real ROAS");
  await expect(page.getByTestId("kpi-roas")).toContainText("5.00x");
  await expect(page.getByTestId("campaign-table")).toContainText(
    "Airco Amsterdam",
  );
  await expect(page.getByText(/gclid-/)).toHaveCount(0);
});

test("partial won revenue is labeled Known-revenue ROAS", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await registerOrganization(
    page,
    "Partial Owner",
    "Partial Company",
    testInfo,
  );
  await page.getByRole("link", { name: "Websites", exact: true }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example NL");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("button", { name: "Enable tracking" }).click();
  await expect(page.getByText("Install snippet")).toBeVisible({
    timeout: 20_000,
  });
  const snippet = await page.getByTestId("tracking-snippet").textContent();
  const siteKey = snippet?.match(/data-site-key="([^"]+)"/)?.[1];
  const appOrigin = new URL(page.url()).origin;
  const organizationSlug = page.url().split("/app/")[1]?.split("/")[0];
  await connectAdsAndEnableAnalytics(page);
  await createAttributedLeads(page, siteKey!, appOrigin, 2, "gclid");
  await runApplyScript("tests/e2e/apply-revenue-analytics.ts", [
    organizationSlug!,
    "partial",
  ]);
  await page.goto(`/app/${organizationSlug}/analytics/revenue`);
  await expect(page.getByTestId("kpi-roas")).toContainText(
    "Known-revenue ROAS",
  );
  await expect(page.getByTestId("kpi-roas")).toContainText("Partial");
  await expect(page.getByTestId("revenue-completeness")).toContainText("1 / 2");
});

test("unresolved clicks keep account revenue and do not spread it", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await registerOrganization(
    page,
    "Unresolved Owner",
    "Unresolved Company",
    testInfo,
  );
  await page.getByRole("link", { name: "Websites", exact: true }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example NL");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("button", { name: "Enable tracking" }).click();
  await expect(page.getByText("Install snippet")).toBeVisible({
    timeout: 20_000,
  });
  const snippet = await page.getByTestId("tracking-snippet").textContent();
  const siteKey = snippet?.match(/data-site-key="([^"]+)"/)?.[1];
  const appOrigin = new URL(page.url()).origin;
  const organizationSlug = page.url().split("/app/")[1]?.split("/")[0];
  await connectAdsAndEnableAnalytics(page);
  await createAttributedLeads(page, siteKey!, appOrigin, 3, "wbraid");
  await runApplyScript("tests/e2e/apply-revenue-analytics.ts", [
    organizationSlug!,
    "unresolved",
  ]);
  await page.goto(`/app/${organizationSlug}/analytics/revenue`);
  await expect(page.getByTestId("kpi-revenue")).toContainText("5,000.00");
  await expect(page.getByTestId("campaign-unresolved")).toContainText(
    "5,000.00",
  );
  await expect(
    page.getByRole("row").filter({ hasText: "Airco Amsterdam" }),
  ).not.toContainText("5,000.00");
});

test("rejected Google conversion feedback does not change realized revenue", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await registerOrganization(page, "Reject Roas", "Reject Roas Co", testInfo);
  await page.getByRole("link", { name: "Websites", exact: true }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example NL");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("button", { name: "Enable tracking" }).click();
  await expect(page.getByText("Install snippet")).toBeVisible({
    timeout: 20_000,
  });
  const snippet = await page.getByTestId("tracking-snippet").textContent();
  const siteKey = snippet?.match(/data-site-key="([^"]+)"/)?.[1];
  const appOrigin = new URL(page.url()).origin;
  const organizationSlug = page.url().split("/app/")[1]?.split("/")[0];

  await page.getByTestId("nav-integrations").click();
  await page.getByTestId("integration-google-ads").click();
  await page.getByRole("button", { name: "Connect Google Ads" }).click();
  await page.getByRole("link", { name: "Approve and continue" }).click();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("button", { name: "Enable conversion feedback" })
    .click();
  await page.getByRole("link", { name: "Approve conversion feedback" }).click();
  await expect(page.getByTestId("data-manager-status")).toContainText(
    "Connected",
    { timeout: 20_000 },
  );
  await page.getByLabel(/Voltios Energie/).check();
  await page.getByRole("button", { name: "Save accounts and sync" }).click();
  await expect(page.getByText("Google Ads scan complete")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Conversion feedback setup" }).click();
  await page
    .getByRole("button", { name: "Refresh conversion actions" })
    .click();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await page
    .getByText("I understand this enables Google conversion writes.")
    .click();
  await page
    .getByRole("button", { name: "Activate conversion feedback" })
    .click();
  await expect(page.getByTestId("conversion-feedback-status")).toHaveText(
    "Active",
    { timeout: 15_000 },
  );
  await page.getByRole("link", { name: "Google Ads" }).click();
  await page.getByRole("link", { name: "Analytics mapping" }).click();
  await page.getByRole("button", { name: "Enable revenue analytics" }).click();
  await expect(page.getByText("ACTIVE")).toBeVisible({ timeout: 15_000 });

  await createAttributedLeads(page, siteKey!, appOrigin, 1, "gclid");
  const applied = await runApplyScript("tests/e2e/apply-revenue-analytics.ts", [
    organizationSlug!,
    "complete",
  ]);
  const [leadId] = parseApplyLeadIds(applied);
  expect(leadId).toBeTruthy();
  await runApplyScript("tests/e2e/apply-conversion-feedback.ts", [
    leadId!,
    "INVALID_GCLID",
  ]);
  await page.goto(`/app/${organizationSlug}/analytics/revenue`);
  await expect(page.getByTestId("kpi-revenue")).toContainText("3,000.00");
  await expect(page.getByTestId("google-feedback-health")).toContainText(
    "Needs attention 1",
  );
});
