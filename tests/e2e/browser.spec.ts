import { expect, test } from "@playwright/test";

function uniqueEmail(prefix: string) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return `${safePrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const password = "CorrectHorse1";
const websiteDetailUrl = /\/app\/[^/]+\/websites\/(?!new(?:\/|$))[^/]+$/;
const monitorDetailUrl =
  /\/app\/[^/]+\/websites\/[^/]+\/monitors\/(?!new(?:\/|$))[^/]+$/;

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

test("happy path: create a browser monitor and queue a check", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Browser Owner", "Browser Company");
  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });

  await page.getByRole("link", { name: "Add monitor" }).click();
  await page.getByRole("radio", { name: /Browser Monitor/ }).check();
  await page.getByLabel("Monitor name").fill("Homepage render");
  await page.getByLabel("URL").fill("https://example.com/");
  await page.getByLabel("Viewport").selectOption("MOBILE");
  await page.getByLabel("Required element name").fill("Quote request");
  await page.getByLabel("Required element selector").fill("#quote-cta");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Homepage render" }),
  ).toBeVisible();
  await expect(page.getByText("Browser monitor")).toBeVisible();
  await expect(page.getByText("Mobile")).toBeVisible();
  await expect(page.getByText(/Quote request/)).toBeVisible();

  await page.getByRole("button", { name: "Run check now" }).click();
  await expect(page.getByText(/Check queued|already queued/)).toBeVisible({
    timeout: 15_000,
  });
});
