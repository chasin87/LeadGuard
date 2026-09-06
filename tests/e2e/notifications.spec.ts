import { expect, registerOrganization, test } from "./fixtures";

test("owner can add an email channel and send a test notification", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Notify Owner", "Notify Company", testInfo);
  await page.getByTestId("nav-settings").click();
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("No notification channels configured"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Add notification channel" })
    .first()
    .click();
  await page.getByLabel("Channel name").first().fill("Operations");
  await page.getByLabel("Email address").fill("alerts@example.test");
  await page.getByRole("button", { name: "Add email channel" }).click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByText("Test notification sent.")).toBeVisible({
    timeout: 20_000,
  });
});
