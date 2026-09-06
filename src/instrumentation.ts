export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isE2eRuntime, isProductionRuntime } =
    await import("@/server/google-ads/config");
  if (!isProductionRuntime() || isE2eRuntime()) return;
  const { assertFakeProviderNotUsedInProduction } =
    await import("@/server/google-ads/config");
  const { assertFakeDataManagerNotUsedInProduction } =
    await import("@/server/google-data-manager/config");
  const { assertBillingProviderAllowed } =
    await import("@/server/billing/config");
  assertFakeProviderNotUsedInProduction();
  assertFakeDataManagerNotUsedInProduction();
  assertBillingProviderAllowed();
}
