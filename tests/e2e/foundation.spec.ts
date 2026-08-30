import { expect, test } from "@playwright/test";

test("landing page links to registration and login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Stop met betalen",
  );
  await page.getByRole("link", { name: "Account maken" }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(
    page.getByRole("heading", { name: "Account maken" }),
  ).toBeVisible();
});

test("protected app routes redirect unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app/voltios-energie/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
