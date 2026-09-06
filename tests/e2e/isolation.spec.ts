import {
  expect,
  openIsolatedPage,
  registerOrganization,
  test,
} from "./fixtures";

test("user B cannot open organization A via a manipulated URL", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const tenantA = await openIsolatedPage(browser, testInfo);
  const createdA = await registerOrganization(
    tenantA.page,
    "Alice Tenant",
    "Organization Alpha",
    testInfo,
  );
  const orgASlug = new URL(createdA.organizationUrl).pathname.split("/")[2];
  if (!orgASlug) {
    throw new Error("Kon de organisatie-slug van tenant A niet bepalen.");
  }

  const tenantB = await openIsolatedPage(browser, testInfo);
  await registerOrganization(
    tenantB.page,
    "Bob Tenant",
    "Organization Beta",
    testInfo,
  );

  await tenantB.page.goto(`/app/${orgASlug}/settings`);
  await expect(
    tenantB.page.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(tenantB.page.getByText("403")).toBeVisible();
  await expect(tenantB.page.getByLabel("Organisatienaam")).toHaveCount(0);

  await tenantA.context.close();
  await tenantB.context.close();
});
