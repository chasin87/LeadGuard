import {
  expect,
  monitorDetailUrl,
  registerOrganization,
  runApplyScript,
  test,
  websiteDetailUrl,
} from "./fixtures";

async function applyCheck(monitorId: string, mode: "FAILURE" | "SUCCESS") {
  await runApplyScript("tests/e2e/apply-monitor-check.ts", [monitorId, mode]);
}

test("failure streak opens an incident and recovery resolves it", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Incident Owner",
    "Incident Company",
    testInfo,
  );
  await expect(
    page.getByRole("heading", { name: "Active incidents" }),
  ).toBeVisible();
  await expect(page.getByText("No open incidents.")).toBeVisible();

  await page.getByRole("link", { name: "Websites" }).click();
  await page.getByRole("link", { name: "Add website" }).first().click();
  await page.getByLabel("Website name").fill("Example");
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page).toHaveURL(websiteDetailUrl, { timeout: 20_000 });
  await page.getByRole("link", { name: "Add monitor" }).click();
  await page.getByLabel("Monitor name").fill("Airco offerte");
  await page.getByLabel("URL").fill("https://example.com/offerte");
  await page.getByRole("button", { name: "Add monitor" }).click();
  await expect(page).toHaveURL(monitorDetailUrl, { timeout: 20_000 });

  const monitorId = page.url().split("/monitors/")[1]?.split(/[?#]/)[0];
  expect(monitorId).toBeTruthy();
  await applyCheck(monitorId!, "FAILURE");
  await applyCheck(monitorId!, "FAILURE");
  await page.reload();
  await expect(page.getByText("Down", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("View open incident")).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Active incidents" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Airco offerte/ })).toBeVisible();

  await page
    .getByRole("link", { name: /Incidents/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Open incidents" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Airco offerte/ })
    .first()
    .click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();

  await applyCheck(monitorId!, "SUCCESS");
  await page.reload();
  await expect(page.getByText("Resolved", { exact: true }).first()).toBeVisible(
    {
      timeout: 20_000,
    },
  );
});
