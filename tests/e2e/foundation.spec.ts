import { expect, test } from "@playwright/test";

test("landing page links to the foundation dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Stop met betalen",
  );
  await page.getByRole("link", { name: "Bekijk de foundation" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("login clearly communicates its phase-one status", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByText("Er worden nog geen inloggegevens gevraagd of opgeslagen."),
  ).toBeVisible();
});
