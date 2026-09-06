import type { BillingPlanKey } from "@/generated/prisma/enums";
import type {
  BillingProvider,
  ProviderSubscription,
  VerifiedBillingEvent,
} from "@/server/billing/provider";
import { stripePriceIdForPlan } from "@/server/billing/config";

type FakeCheckout = {
  organizationId: string;
  customerId: string;
  planKey: BillingPlanKey;
  priceId: string;
  status: string;
  subscriptionId: string | null;
  url: string;
  idempotencyKey: string | null;
};

type FakeStore = {
  customers: Map<string, { organizationId: string }>;
  subscriptions: Map<string, ProviderSubscription>;
  checkouts: Map<string, FakeCheckout>;
  checkoutByIdempotency: Map<string, string>;
  events: VerifiedBillingEvent[];
};

const globalFake = globalThis as unknown as {
  leadguardBillingFake?: FakeStore;
};

function store(): FakeStore {
  globalFake.leadguardBillingFake ??= {
    customers: new Map(),
    subscriptions: new Map(),
    checkouts: new Map(),
    checkoutByIdempotency: new Map(),
    events: [],
  };
  return globalFake.leadguardBillingFake;
}

export function resetFakeBillingWorld() {
  globalFake.leadguardBillingFake = {
    customers: new Map(),
    subscriptions: new Map(),
    checkouts: new Map(),
    checkoutByIdempotency: new Map(),
    events: [],
  };
}

function unixDate(offsetDays = 30) {
  const start = new Date();
  const end = new Date(start.getTime() + offsetDays * 86_400_000);
  return { start, end };
}

export function createFakeBillingProvider(): BillingProvider & {
  verifyWebhook(
    payload: string,
    signature: string | null,
  ): Promise<VerifiedBillingEvent>;
  hydrateCheckout(input: {
    id: string;
    organizationId: string;
    customerId: string;
    planKey: BillingPlanKey;
    priceId: string;
  }): void;
  completeCheckout(sessionId: string): VerifiedBillingEvent;
  failInvoice(subscriptionId: string): VerifiedBillingEvent;
  recoverInvoice(subscriptionId: string): VerifiedBillingEvent;
  cancelAtPeriodEnd(subscriptionId: string): VerifiedBillingEvent;
  applyPlan(
    subscriptionId: string,
    planKey: BillingPlanKey,
  ): VerifiedBillingEvent;
} {
  function pushEvent(type: string, data: unknown): VerifiedBillingEvent {
    const event: VerifiedBillingEvent = {
      id: `evt_fake_${crypto.randomUUID()}`,
      type,
      created: new Date(),
      livemode: false,
      data,
    };
    store().events.push(event);
    return event;
  }

  return {
    async createCustomer(input) {
      const id = `cus_fake_${input.organizationId}`;
      store().customers.set(id, { organizationId: input.organizationId });
      return { providerCustomerId: id };
    },
    async createCheckoutSession(input) {
      const existingId = store().checkoutByIdempotency.get(
        input.idempotencyKey,
      );
      if (existingId) {
        const existing = store().checkouts.get(existingId);
        if (existing && existing.status === "open") {
          return {
            id: existingId,
            url: existing.url,
            expiresAt: new Date(Date.now() + 3_600_000),
          };
        }
      }
      const id = `cs_fake_${crypto.randomUUID()}`;
      const url = `/api/billing/fake/checkout?session=${encodeURIComponent(id)}`;
      store().checkouts.set(id, {
        organizationId: input.organizationId,
        customerId: input.customerId,
        planKey: input.planKey,
        priceId: input.priceId,
        status: "open",
        subscriptionId: null,
        url,
        idempotencyKey: input.idempotencyKey,
      });
      store().checkoutByIdempotency.set(input.idempotencyKey, id);
      return {
        id,
        url,
        expiresAt: new Date(Date.now() + 3_600_000),
      };
    },
    async createPortalSession(input) {
      return {
        url: `/api/billing/fake/portal?customer=${encodeURIComponent(input.customerId)}`,
      };
    },
    async retrieveSubscription(id) {
      return store().subscriptions.get(id) ?? null;
    },
    async retrieveCheckoutSession(sessionId) {
      const row = store().checkouts.get(sessionId);
      if (!row) return null;
      return {
        id: sessionId,
        url: row.url,
        customerId: row.customerId,
        subscriptionId: row.subscriptionId,
        status: row.status,
      };
    },
    async cancelSubscription(providerSubscriptionId) {
      const current = store().subscriptions.get(providerSubscriptionId);
      if (!current) return;
      current.cancelAtPeriodEnd = true;
      current.status = "active";
    },
    async verifyWebhook(payload, signature) {
      if (
        signature !== "fake-signature" &&
        process.env.E2E_RUNTIME !== "true"
      ) {
        throw new Error("Invalid fake webhook signature.");
      }
      return JSON.parse(payload) as VerifiedBillingEvent;
    },
    hydrateCheckout(input) {
      store().checkouts.set(input.id, {
        organizationId: input.organizationId,
        customerId: input.customerId,
        planKey: input.planKey,
        priceId: input.priceId,
        status: "open",
        subscriptionId: null,
        url: `/api/billing/fake/checkout?session=${encodeURIComponent(input.id)}`,
        idempotencyKey: null,
      });
      store().customers.set(input.customerId, {
        organizationId: input.organizationId,
      });
    },
    completeCheckout(sessionId) {
      const checkout = store().checkouts.get(sessionId);
      if (!checkout) throw new Error("Unknown fake checkout session.");
      const { start, end } = unixDate(30);
      const subId = `sub_fake_${crypto.randomUUID()}`;
      const subscription: ProviderSubscription = {
        id: subId,
        customerId: checkout.customerId,
        status: "active",
        priceId: checkout.priceId,
        quantity: 1,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
        created: start,
      };
      store().subscriptions.set(subId, subscription);
      checkout.status = "complete";
      checkout.subscriptionId = subId;
      return pushEvent("customer.subscription.updated", subscription);
    },
    failInvoice(subscriptionId) {
      const current = store().subscriptions.get(subscriptionId);
      if (!current) throw new Error("Unknown fake subscription.");
      current.status = "past_due";
      return pushEvent("invoice.payment_failed", {
        object: "invoice",
        subscription: current.id,
        customer: current.customerId,
      });
    },
    recoverInvoice(subscriptionId) {
      const current = store().subscriptions.get(subscriptionId);
      if (!current) throw new Error("Unknown fake subscription.");
      current.status = "active";
      return pushEvent("invoice.paid", {
        object: "invoice",
        subscription: current.id,
        customer: current.customerId,
      });
    },
    cancelAtPeriodEnd(subscriptionId) {
      const current = store().subscriptions.get(subscriptionId);
      if (!current) throw new Error("Unknown fake subscription.");
      current.cancelAtPeriodEnd = true;
      return pushEvent("customer.subscription.updated", current);
    },
    applyPlan(subscriptionId, planKey) {
      const current = store().subscriptions.get(subscriptionId);
      if (!current) throw new Error("Unknown fake subscription.");
      current.priceId =
        stripePriceIdForPlan(planKey, {
          STRIPE_PRICE_STARTER_MONTHLY: "price_fake_starter",
          STRIPE_PRICE_GROWTH_MONTHLY: "price_fake_growth",
          STRIPE_PRICE_PRO_MONTHLY: "price_fake_pro",
          STRIPE_PRICE_AGENCY_MONTHLY: "price_fake_agency",
        }) ?? `price_fake_${planKey.toLowerCase()}`;
      current.status = "active";
      return pushEvent("customer.subscription.updated", current);
    },
  };
}

export function getFakeBillingStore() {
  return store();
}

export { fakePriceEnv } from "@/server/billing/config";
