import { expect, password, test, uniqueEmail } from "./fixtures";

test("happy path: register, onboard, settings, logout, login", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const email = uniqueEmail("happy", testInfo);

  await page.goto("/register");
  await page.getByLabel("Naam").fill("Yasin Yuksek");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Account aanmaken" }).click();

  await expect(
    page.getByRole("heading", { name: "Maak je organisatie" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Bedrijfsnaam").fill("Voltios Energie");
  await page.getByRole("button", { name: "Organisatie maken" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(
    /\/app\/voltios-energie(?:-[a-z0-9]+)?\/dashboard$/,
  );
  await expect(
    page.getByRole("heading", { name: "No websites yet" }),
  ).toBeVisible();

  await page.getByTestId("nav-settings").click();
  await expect(
    page.getByRole("heading", { name: "Instellingen" }),
  ).toBeVisible();
  await expect(page.getByLabel("Organisatienaam")).toHaveValue(
    "Voltios Energie",
  );
  await expect(page.getByLabel("Slug")).toHaveValue(/voltios-energie/);

  const dashboardUrl = page.url().replace(/\/settings$/, "/dashboard");
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Inloggen" })).toBeVisible();
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies();
      return cookies.some((cookie) => cookie.name.includes("session-token"));
    })
    .toBe(false);
  await page.goto(`${dashboardUrl}?signedout=1`);
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(
    /\/app\/voltios-energie(?:-[a-z0-9]+)?\/dashboard$/,
  );
});

test("wrong credentials show a generic error", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(uniqueEmail("nobody", testInfo));
  await page.getByLabel("Wachtwoord").fill("WrongPassword1");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(
    page.getByText("E-mailadres of wachtwoord is onjuist."),
  ).toBeVisible();
});
