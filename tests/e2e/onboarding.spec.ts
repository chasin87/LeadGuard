import {
  expect,
  monitorDetailUrl,
  registerOrganization,
  runApplyScript,
  test,
  websiteDetailUrl,
} from "./fixtures";

test("new trial org can complete core onboarding", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Onboard Owner",
    "Onboard Company",
    testInfo,
  );
  await expect(page.getByTestId("onboarding-checklist")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Get LeadGuard protecting your leads" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("link", { name: "Add monitor" }).click();
  await page.getByLabel("Monitor name").fill("Homepage");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });
  const monitorId = page.url().split("/").at(-1);
  if (!monitorId) throw new Error("Missing monitor id");
  await runApplyScript("tests/e2e/apply-monitor-check.ts", [
    monitorId,
    "SUCCESS",
  ]);
  await page.getByTestId("nav-settings").click();
  await page.getByRole("link", { name: "Notifications" }).click();
  await page
    .getByRole("link", { name: "Add notification channel" })
    .first()
    .click();
  await page.getByLabel("Channel name").first().fill("Ops");
  await page.getByLabel("Email address").fill("ops@example.test");
  await page.getByRole("button", { name: "Add email channel" }).click();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("onboarding-checklist")).toHaveCount(0);
});
