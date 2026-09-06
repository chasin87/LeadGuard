import {
  expect,
  monitorDetailUrl,
  registerOrganization,
  test,
  websiteDetailUrl,
} from "./fixtures";

test("happy path: add monitor, queue a check, and pause", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(
    page,
    "Monitor Owner",
    "Monitor Company",
    testInfo,
  );
  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });

  await expect(page.getByText("No monitors yet")).toBeVisible();
  await page.getByRole("link", { name: "Add monitor" }).click();
  await page.getByLabel("Monitor name").fill("Airco landingpage");
  await page.getByLabel("URL").fill("https://example.com/airco");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Airco landingpage" }),
  ).toBeVisible();
  await expect(page.getByText("Pending first check").first()).toBeVisible();

  await page.getByRole("button", { name: "Run check now" }).click();
  await expect(page.getByText(/Check queued|already queued/)).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
});
