import { expect, test } from "@playwright/test";

const password = "correct horse battery staple";

test("registration, organization, logout and login", async ({ page }) => {
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `e2e-${marker}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Naam", { exact: true }).fill("E2E User");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByLabel("Bedrijfsnaam").fill(`E2E Organization ${marker}`);
  await page.getByRole("button", { name: "Account en organisatie maken" }).click();
  await expect(page).toHaveURL(/\/app\/[^/]+\/dashboard$/);
  await page.getByRole("link", { name: "Instellingen" }).click();
  await expect(page.getByText(`E2E Organization ${marker}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(page.url().replace("/login", "/app/forbidden/dashboard"));
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/app\/[^/]+\/dashboard$/);
});

test("one tenant cannot open another tenant by slug", async ({ browser }) => {
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const register = async (label: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/register");
    await page.getByLabel("Naam", { exact: true }).fill(`User ${label}`);
    await page.getByLabel("E-mailadres").fill(`${label}-${marker}@example.test`);
    await page.getByLabel("Wachtwoord").fill(password);
    await page.getByLabel("Bedrijfsnaam").fill(`Tenant ${label} ${marker}`);
    await page.getByRole("button", { name: "Account en organisatie maken" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    return { context, page, slug: new URL(page.url()).pathname.split("/")[2] };
  };
  const tenantA = await register("a");
  const tenantB = await register("b");
  await tenantA.page.goto(`/app/${tenantB.slug}/settings`);
  await expect(tenantA.page.getByRole("heading", { name: "Organisatie" })).not.toBeVisible();
  await expect(tenantA.page).toHaveURL(new RegExp(`/app/${tenantB.slug}/settings`));
  await tenantA.context.close();
  await tenantB.context.close();
});
