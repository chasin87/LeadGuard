import { expect, registerOrganization, runApplyScript, test } from "./fixtures";

test("trial organization can complete fake Checkout to Growth", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(
    page,
    "Billing Owner",
    "Billing Company",
    testInfo,
  );
  await page.getByTestId("nav-billing").click();
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByTestId("current-plan")).toHaveText("Growth");
  await expect(page.getByTestId("subscription-status")).toContainText(
    "TRIALING",
  );
  await page.getByRole("button", { name: "Choose Pro" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm LeadGuard subscription" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Approve and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Subscription confirmed" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Back to billing" }).click();
  await expect(page.getByTestId("current-plan")).toHaveText("Pro");
  await expect(page.getByTestId("subscription-status")).toContainText("ACTIVE");
});

test("downgrade over-limit keeps websites and shows the limit", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Limit Owner", "Limit Company", testInfo);
  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("First");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(/\/websites\/(?!new)/, { timeout: 20_000 });
  const slug = page.url().match(/\/app\/([^/]+)\//)?.[1];
  if (!slug) throw new Error("Missing organization slug");
  await runApplyScript("tests/e2e/apply-billing.ts", [slug, "starter"]);
  await page.getByTestId("nav-billing").click();
  await expect(
    page.getByText(/Plan limit exceeded|1 \/ 1|used/i),
  ).toBeVisible();
});

test("payment failure shows a grace banner while billing stays reachable", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(
    page,
    "Past Due Owner",
    "Past Due Company",
    testInfo,
  );
  const slug = page.url().match(/\/app\/([^/]+)\//)?.[1];
  if (!slug) throw new Error("Missing organization slug");
  await runApplyScript("tests/e2e/apply-billing.ts", [slug, "past_due"]);
  await page.reload();
  await expect(page.getByTestId("billing-banner")).toContainText(
    "Payment failed",
  );
  await page.getByTestId("nav-billing").click();
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByTestId("subscription-status")).toContainText(
    /GRACE_PERIOD|PAST_DUE/,
  );
});
