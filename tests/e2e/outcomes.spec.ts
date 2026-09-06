import {
  expect,
  grantTrackingConsent,
  installCustomerSite,
  registerOrganization,
  test,
  trackLead,
  uniqueId,
  visitCustomer,
  websiteDetailUrl,
} from "./fixtures";

test("API outcome event marks a tracked lead won", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(page, "Outcome Api", "Outcome Api Co", testInfo);
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
  const externalLeadId = uniqueId("quote");
  const eventId = uniqueId("won");

  await installCustomerSite(page, siteKey!, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("ingest")}`);
  await grantTrackingConsent(page);
  await trackLead(page, {
    eventId: crypto.randomUUID(),
    externalLeadId,
  });

  await page.goto("/app");
  await page.getByTestId("nav-integrations").click();
  await page.getByTestId("integration-outcomes").click();
  await page.getByLabel("Name").fill("E2E CRM");
  await page.getByLabel("Source system").fill(`e2e-crm-${uniqueId("src")}`);
  await page.getByText("Example NL").click();
  await page.getByRole("button", { name: "Create" }).click();
  const credential = await page.getByTestId("outcome-credential").textContent();
  expect(credential?.startsWith("lgoi_")).toBe(true);

  const response = await request.post(`${appOrigin}/api/outcomes/v1/events`, {
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    data: {
      eventId,
      externalLeadId,
      status: "WON",
      effectiveAt: new Date().toISOString(),
      revenue: { amount: "4500.00", currency: "EUR" },
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { status: string };
  expect(body.status).toBe("APPLIED");

  const duplicate = await request.post(`${appOrigin}/api/outcomes/v1/events`, {
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    data: {
      eventId,
      externalLeadId,
      status: "WON",
      effectiveAt: new Date().toISOString(),
      revenue: { amount: "4500.00", currency: "EUR" },
    },
  });
  expect(((await duplicate.json()) as { status: string }).status).toBe(
    "DUPLICATE",
  );

  await page.getByRole("link", { name: "Attribution" }).click();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await expect(page.getByText("Won").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("4,500.00").first()).toBeVisible();
  await expect(page.getByText(/ingest-/)).toHaveCount(0);
});
