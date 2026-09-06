import {
  expect,
  monitorDetailUrl,
  registerOrganization,
  test,
  websiteDetailUrl,
} from "./fixtures";

test("happy path: create a browser monitor and queue a check", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(
    page,
    "Browser Owner",
    "Browser Company",
    testInfo,
  );
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
