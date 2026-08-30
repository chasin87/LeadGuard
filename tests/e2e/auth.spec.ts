import { expect, test } from "@playwright/test";

function uniqueEmail(prefix: string) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return `${safePrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const password = "CorrectHorse1";

test("happy path: register, onboard, settings, logout, login", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const email = uniqueEmail("happy");

  await page.goto("/register");
  await page.getByLabel("Naam").fill("Yasin Yuksek");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Account aanmaken" }).click();

  await expect(
    page.getByRole("heading", { name: "Maak je organisatie" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Bedrijfsnaam").fill("Voltios Energie");
  await page.getByRole("button", { name: "Organisatie maken" }).click();

  await expect(page).toHaveURL(/\/app\/voltios-energie(?:-\d+)?\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No websites yet" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Instellingen" }),
  ).toBeVisible();
  await expect(page.getByLabel("Organisatienaam")).toHaveValue(
    "Voltios Energie",
  );
  await expect(page.getByLabel("Slug")).toHaveValue(/voltios-energie/);

  const dashboardUrl = page.url().replace(/\/settings$/, "/dashboard");
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(dashboardUrl);
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/app\/voltios-energie(?:-\d+)?\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("wrong credentials show a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill("nobody@example.com");
  await page.getByLabel("Wachtwoord").fill("WrongPassword1");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(
    page.getByText("E-mailadres of wachtwoord is onjuist."),
  ).toBeVisible();
});
