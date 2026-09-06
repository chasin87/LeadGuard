import {
  expect,
  openIsolatedPage,
  registerOrganization,
  runApplyScript,
  test,
} from "./fixtures";

test("organization OWNER cannot open platform admin", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await registerOrganization(page, "Plain Owner", "Plain Company", testInfo);
  await page.goto("/platform-admin");
  await expect(page.getByTestId("platform-access-denied")).toBeVisible();
});

test("SUPER_ADMIN can search, inspect, suspend and see audit", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const registered = await registerOrganization(
    page,
    "Platform Super",
    "Platform Super Org",
    testInfo,
  );
  await runApplyScript("tests/e2e/apply-platform-admin.ts", [
    registered.email,
    "SUPER_ADMIN",
    "heartbeat",
  ]);
  await page.goto("/platform-admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Organizations" }).click();
  await page.getByTestId("org-search").fill("Platform Super Org");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("org-row")).toContainText("Platform Super Org");
  await page.getByRole("link", { name: "Platform Super Org" }).click();
  await expect(page.getByText(/Account status:/)).toBeVisible();
  await expect(page.getByTestId("account-status")).toContainText("ACTIVE");
  await page.getByTestId("tab-billing").click();
  await expect(page.getByText("LeadGuard status:")).toBeVisible();
  await page.getByTestId("tab-overview").click();
  await page.getByLabel("Details").fill("e2e");
  await page
    .getByLabel(`Type Platform Super Org to suspend`)
    .fill("Platform Super Org");
  await page
    .getByRole("button", { name: "Suspend Platform Super Org?" })
    .click();
  await expect(page.getByTestId("platform-action-message")).toContainText(
    "Organization suspended",
  );
  await expect(page.getByTestId("account-status")).toContainText("SUSPENDED");
  await page.getByLabel("Reason").fill("restored after review");
  await page
    .getByLabel(`Type Platform Super Org to reactivate`)
    .fill("Platform Super Org");
  await page.getByRole("button", { name: "Reactivate organization" }).click();
  await expect(page.getByTestId("account-status")).toContainText("ACTIVE");
  await page.goto("/platform-admin/operations");
  await expect(page.getByTestId("worker-health")).toContainText("SCHEDULER");
  await expect(page.getByTestId("queue-summary")).toBeVisible();
  await page.goto("/platform-admin/audit");
  await expect(page.getByTestId("audit-list")).toContainText(
    "ORGANIZATION_SUSPENDED",
  );
});

test("SUPPORT can inspect but cannot suspend or override", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await registerOrganization(
    page,
    "Support Target",
    "Support Target Org",
    testInfo,
  );
  const isolated = await openIsolatedPage(browser, testInfo);
  try {
    const support = await registerOrganization(
      isolated.page,
      "Support Agent",
      "Support Agent Org",
      testInfo,
    );
    await runApplyScript("tests/e2e/apply-platform-admin.ts", [
      support.email,
      "SUPPORT",
    ]);
    await isolated.page.goto("/platform-admin");
    await expect(
      isolated.page.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    await isolated.page.getByRole("link", { name: "Organizations" }).click();
    await isolated.page.getByTestId("org-search").fill("Support Target Org");
    await isolated.page.getByRole("button", { name: "Search" }).click();
    await isolated.page
      .getByRole("link", { name: "Support Target Org" })
      .click();
    await expect(isolated.page.getByTestId("account-status")).toBeVisible();
    await expect(
      isolated.page.getByRole("button", { name: /Suspend/ }),
    ).toHaveCount(0);
    await isolated.page.getByTestId("tab-usage").click();
    await expect(
      isolated.page.getByText("Support cannot create entitlement overrides."),
    ).toBeVisible();
  } finally {
    await isolated.context.close();
  }
});
