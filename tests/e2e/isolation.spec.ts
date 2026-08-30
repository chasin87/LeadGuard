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
  return { email, organizationUrl: page.url() };
}

test("user B cannot open organization A via a manipulated URL", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const tenantA = await registerOrganization(
    pageA,
    "Alice Tenant",
    "Organization Alpha",
  );
  const orgASlug = new URL(tenantA.organizationUrl).pathname.split("/")[2];
  if (!orgASlug) {
    throw new Error("Kon de organisatie-slug van tenant A niet bepalen.");
  }

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await registerOrganization(pageB, "Bob Tenant", "Organization Beta");

  await pageB.goto(`/app/${orgASlug}/settings`);
  await expect(
    pageB.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(pageB.getByText("403")).toBeVisible();
  await expect(pageB.getByLabel("Organisatienaam")).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
