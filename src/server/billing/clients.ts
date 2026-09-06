import { createFakeBillingProvider } from "@/server/billing/fake";
import { createStripeBillingProvider } from "@/server/billing/stripe";
import {
  assertBillingProviderAllowed,
  getBillingProviderKind,
} from "@/server/billing/config";
import type { BillingProviderModule } from "@/server/billing/provider";

let cached: BillingProviderModule | undefined;

export function getBillingProvider(): BillingProviderModule {
  assertBillingProviderAllowed();
  cached ??=
    getBillingProviderKind() === "stripe"
      ? createStripeBillingProvider()
      : createFakeBillingProvider();
  return cached;
}

export function resetBillingProviderCache() {
  cached = undefined;
}
