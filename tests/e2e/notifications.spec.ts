import { expect, test } from "@playwright/test";

function uniqueEmail(prefix: string) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return `${safePrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const password = "CorrectHorse1";

async function registerOrganization(
  page: import("@playwright/test").Page,
  name: string,
  organizationName: string,
) {
  const email = uniqueEmail(name);
  await page.goto("/register");
  await page.getByLabel("Naam").fill(name);
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await expect(
    page.getByRole("heading", { name: "Maak je organisatie" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Bedrijfsnaam").fill(organizationName);
  await page.getByRole("button", { name: "Organisatie maken" }).click();
  await expect(page).toHaveURL(/\/app\/.+\/dashboard$/);
}

test("owner can add an email channel and send a test notification", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Notify Owner", "Notify Company");
  await page.getByRole("link", { name: "Settings" }).click();
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
  await page.getByLabel("Email address").fill("alerts@example.com");
  await page.getByRole("button", { name: "Add email channel" }).click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByText("Test notification sent.")).toBeVisible({
    timeout: 20_000,
  });
});
