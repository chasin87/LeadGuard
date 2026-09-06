import {
  expect,
  grantTrackingConsent,
  installCustomerSite,
  registerOrganization,
  test,
  trackLead,
  uniqueId,
  visitCustomer,
  waitForLeadGuard,
  websiteDetailUrl,
} from "./fixtures";

async function createTrackedWebsite(page: import("@playwright/test").Page) {
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
  const secretText = await page
    .getByText("Server secret (shown once):")
    .textContent();
  const serverSecret = secretText
    ?.replace("Server secret (shown once):", "")
    .trim();
  expect(serverSecret?.startsWith("lgsrv_")).toBe(true);
  return {
    siteKey: siteKey!,
    serverSecret: serverSecret!,
    appOrigin: new URL(page.url()).origin,
    websiteUrl: page.url(),
  };
}

test("captures a Google Ads click after consent and attributes a lead", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Tracking Owner",
    "Tracking Company",
    testInfo,
  );
  const { siteKey, appOrigin } = await createTrackedWebsite(page);
  await installCustomerSite(page, siteKey, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("gclid")}`);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/gclid/i);
  await grantTrackingConsent(page);
  await trackLead(page, {
    eventId: crypto.randomUUID(),
    externalLeadId: uniqueId("ext"),
  });
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await expect(page.getByText("Attributed to Google Ads")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("GCLID captured")).toBeVisible();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await expect(page.getByText("Last paid touch")).toBeVisible();
  await expect(page.getByText(/gclid-/)).toHaveCount(0);
});

test("server API lead uses the attribution token", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Tracking Server",
    "Tracking Server Co",
    testInfo,
  );
  const { siteKey, serverSecret, appOrigin } = await createTrackedWebsite(page);
  await installCustomerSite(page, siteKey, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("server")}`);
  await grantTrackingConsent(page);
  await expect
    .poll(async () =>
      page.evaluate(() => window.LeadGuard?.getAttributionToken()),
    )
    .toMatch(/^lgat_/);
  const token = await page.evaluate(() =>
    window.LeadGuard?.getAttributionToken(),
  );
  const response = await request.post(`${appOrigin}/api/tracking/v1/leads`, {
    headers: {
      Authorization: `Bearer ${serverSecret}`,
      "Content-Type": "application/json",
    },
    data: {
      eventId: crypto.randomUUID(),
      attributionToken: token,
      externalLeadId: uniqueId("backend"),
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await expect(page.getByText("GCLID captured")).toBeVisible({
    timeout: 20_000,
  });
});

test("denied consent does not persist tracking cookies", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(
    page,
    "Tracking Deny",
    "Tracking Deny Co",
    testInfo,
  );
  const { siteKey, websiteUrl, appOrigin } = await createTrackedWebsite(page);
  await installCustomerSite(page, siteKey, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("denied")}`);
  await waitForLeadGuard(page);
  await page.evaluate(() => {
    window.LeadGuard?.setConsent({ attribution: "denied" });
  });
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies();
      return cookies.some((cookie) => cookie.name === "_lg_vid");
    })
    .toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(
    /gclid|denied/i,
  );
  await page.goto(websiteUrl);
  await expect(page.getByText("No events yet")).toBeVisible();
});

test("a later Google click becomes primary for a new lead", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Tracking Second",
    "Tracking Second Co",
    testInfo,
  );
  const { siteKey, appOrigin } = await createTrackedWebsite(page);
  await installCustomerSite(page, siteKey, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("click-a")}`);
  await grantTrackingConsent(page);
  await visitCustomer(page, `?gclid=${uniqueId("click-b")}`);
  await grantTrackingConsent(page);
  await trackLead(page, { eventId: crypto.randomUUID() });
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await expect(page.getByText("Attributed to Google Ads")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/click-a|click-b/)).toHaveCount(0);
});

test("owner can mark a lead won with revenue and later correct it to lost", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Outcome Owner",
    "Outcome Company",
    testInfo,
  );
  const { siteKey, appOrigin } = await createTrackedWebsite(page);
  await installCustomerSite(page, siteKey, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("outcome")}`);
  await grantTrackingConsent(page);
  await trackLead(page, { eventId: crypto.randomUUID() });
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await expect(page.getByText("GCLID captured")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("New").first()).toBeVisible();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await expect(page.getByText("Last paid touch")).toBeVisible();
  await expect(page.getByText(/outcome-/)).toHaveCount(0);
  await page.getByLabel("Status").selectOption("QUALIFIED");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("Qualified").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Status").selectOption("WON");
  await page.getByLabel("Revenue amount").fill("4500.00");
  await page.getByLabel("Currency").fill("EUR");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("4,500.00").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("GCLID captured", { exact: true })).toBeVisible();
  await page.getByLabel("Status").selectOption("LOST");
  await page
    .getByText(
      "I confirm this is a correction or reactivation of a Won or Lost lead.",
    )
    .click();
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("Lost").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("Previous revenue removed from current outcome"),
  ).toBeVisible();
  await expect(page.getByText("4,500.00").first()).toBeVisible();
});

test("NEW to LOST does not show revenue", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(page, "Outcome Lost", "Outcome Lost Co", testInfo);
  const { siteKey, appOrigin } = await createTrackedWebsite(page);
  await installCustomerSite(page, siteKey, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("lost")}`);
  await grantTrackingConsent(page);
  await trackLead(page, { eventId: crypto.randomUUID() });
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await page.getByLabel("Status").selectOption("LOST");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("Lost").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Revenue not entered")).toHaveCount(0);
  await expect(page.getByText(/lost-/)).toHaveCount(0);
});
