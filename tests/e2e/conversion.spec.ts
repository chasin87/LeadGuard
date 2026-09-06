import {
  expect,
  grantTrackingConsent,
  installCustomerSite,
  registerOrganization,
  runApplyScript,
  test,
  trackLead,
  uniqueId,
  visitCustomer,
  websiteDetailUrl,
} from "./fixtures";

test("Google conversion feedback: reconnect, won export, API duplicate, and rejection", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300_000);
  await registerOrganization(
    page,
    "Conversion Owner",
    "Conversion Company",
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

  await page.getByTestId("nav-integrations").click();
  await page.getByTestId("integration-google-ads").click();
  await page.getByRole("button", { name: "Connect Google Ads" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect LeadGuard to Google Ads" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Approve and continue" }).click();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText("Additional Google permission required"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enable conversion feedback" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Enable conversion feedback" }),
  ).toBeVisible({ timeout: 15_000 });
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
  await expect(page.getByLabel("Conversion action")).toContainText(
    "Qualified Lead - Won",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText("Google Ads Conversion Feedback")).toBeVisible({
    timeout: 20_000,
  });
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

  await installCustomerSite(page, siteKey!, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("gclid")}`);
  await grantTrackingConsent(page);
  const externalLeadId = uniqueId("quote");
  await trackLead(page, {
    eventId: crypto.randomUUID(),
    externalLeadId,
  });
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await expect(page.getByTestId("lead-outcome-form")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await page.getByRole("combobox", { name: "Status" }).selectOption("WON");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue(
    "WON",
  );
  await expect(page.getByLabel("Revenue amount")).toBeVisible();
  await page.getByLabel("Revenue amount").fill("4500.00");
  await page.getByLabel("Currency").fill("EUR");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("4,500.00").first()).toBeVisible({
    timeout: 15_000,
  });
  const leadId = page.url().split("/attribution/")[1]?.split("?")[0];
  expect(leadId).toBeTruthy();
  await runApplyScript("tests/e2e/apply-conversion-feedback.ts", [leadId!]);
  await page.reload();
  await expect(page.getByTestId("google-conversion-status")).toHaveText(
    "Succeeded",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("google-conversion-value")).toContainText(
    "4,500.00",
  );
  await expect(page.getByText(/gclid-/)).toHaveCount(0);

  await page.getByTestId("nav-integrations").click();
  await page.getByTestId("integration-outcomes").click();
  await page.getByLabel("Name").fill("E2E CRM");
  await page.getByLabel("Source system").fill(`e2e-crm-${uniqueId("src")}`);
  await page.getByText("Example NL").click();
  await page.getByRole("button", { name: "Create" }).click();
  const credential = await page.getByTestId("outcome-credential").textContent();
  expect(credential?.startsWith("lgoi_")).toBe(true);
  const eventId = uniqueId("won");
  const outcomePayload = {
    eventId,
    externalLeadId,
    status: "WON",
    effectiveAt: new Date().toISOString(),
    revenue: { amount: "4500.00", currency: "EUR" },
  };
  const response = await request.post(`${appOrigin}/api/outcomes/v1/events`, {
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    data: outcomePayload,
  });
  expect(["APPLIED", "DUPLICATE"]).toContain(
    ((await response.json()) as { status: string }).status,
  );
  const duplicate = await request.post(`${appOrigin}/api/outcomes/v1/events`, {
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    data: outcomePayload,
  });
  expect(((await duplicate.json()) as { status: string }).status).toBe(
    "DUPLICATE",
  );
  await runApplyScript("tests/e2e/apply-conversion-feedback.ts", [leadId!]);
  await page.goto(`/app`);
  await page.getByRole("link", { name: "Attribution" }).click();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await expect(page.getByTestId("google-conversion-status")).toHaveText(
    "Succeeded",
  );
});

test("Google conversion feedback shows a safe rejection diagnostic", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await registerOrganization(page, "Reject Owner", "Reject Company", testInfo);
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
  await expect(page.getByLabel("Conversion action")).toContainText(
    "Qualified Lead - Won",
    { timeout: 20_000 },
  );
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

  await installCustomerSite(page, siteKey!, appOrigin);
  await visitCustomer(page, `?gclid=${uniqueId("bad")}`);
  await grantTrackingConsent(page);
  await trackLead(page, { eventId: crypto.randomUUID() });
  await page.goto("/app");
  await page.getByRole("link", { name: "Attribution" }).click();
  await page.getByRole("link", { name: /^lgl_/ }).first().click();
  await expect(page.getByTestId("lead-outcome-form")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await page.getByRole("combobox", { name: "Status" }).selectOption("WON");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue(
    "WON",
  );
  await expect(page.getByLabel("Revenue amount")).toBeVisible();
  await page.getByLabel("Revenue amount").fill("4500.00");
  await page.getByLabel("Currency").fill("EUR");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("4,500.00").first()).toBeVisible({
    timeout: 15_000,
  });
  const leadId = page.url().split("/attribution/")[1]?.split("?")[0];
  await runApplyScript("tests/e2e/apply-conversion-feedback.ts", [
    leadId!,
    "INVALID_GCLID",
  ]);
  await page.reload();
  await expect(
    page.getByText("Google Ads rejected this conversion"),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/gclid-|bad-/)).toHaveCount(0);
});
