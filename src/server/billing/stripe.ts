import Stripe from "stripe";
import { getBillingConfig, stripeApiVersion } from "@/server/billing/config";
import type {
  BillingProvider,
  ProviderSubscription,
  VerifiedBillingEvent,
} from "@/server/billing/provider";

let cached: Stripe | undefined;

export function getStripeClient(): Stripe {
  const config = getBillingConfig();
  if (!config.secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required for Stripe billing.");
  }
  cached ??= new Stripe(config.secretKey, {
    apiVersion: stripeApiVersion,
    typescript: true,
  });
  return cached;
}

function periodFromSubscription(subscription: Stripe.Subscription): {
  start: Date;
  end: Date;
} {
  const item = subscription.items.data[0];
  const startUnix = item?.current_period_start ?? subscription.start_date;
  const endUnix = item?.current_period_end ?? subscription.start_date;
  return {
    start: new Date(startUnix * 1000),
    end: new Date(endUnix * 1000),
  };
}

function priceIdFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  const price = subscription.items.data[0]?.price;
  return typeof price === "string" ? price : (price?.id ?? null);
}

export function mapStripeSubscription(
  subscription: Stripe.Subscription,
): ProviderSubscription {
  const period = periodFromSubscription(subscription);
  return {
    id: subscription.id,
    customerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    status: subscription.status,
    priceId: priceIdFromSubscription(subscription),
    quantity: subscription.items.data[0]?.quantity ?? 1,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    trialStart: subscription.trial_start
      ? new Date(subscription.trial_start * 1000)
      : null,
    trialEnd: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000)
      : null,
    endedAt: subscription.ended_at
      ? new Date(subscription.ended_at * 1000)
      : null,
    created: new Date(subscription.created * 1000),
  };
}

export function createStripeBillingProvider(): BillingProvider & {
  verifyWebhook(
    payload: string,
    signature: string | null,
  ): Promise<VerifiedBillingEvent>;
} {
  return {
    async createCustomer(input) {
      const stripe = getStripeClient();
      const customer = await stripe.customers.create(
        {
          email: input.email ?? undefined,
          name: input.name ?? undefined,
          metadata: { organizationId: input.organizationId },
        },
        { idempotencyKey: `customer:${input.organizationId}` },
      );
      return { providerCustomerId: customer.id };
    },
    async createCheckoutSession(input) {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: input.customerId,
          client_reference_id: input.organizationId,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          line_items: [{ price: input.priceId, quantity: 1 }],
          subscription_data: {
            metadata: { organizationId: input.organizationId },
          },
          metadata: {
            organizationId: input.organizationId,
            planKey: input.planKey,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!session.url) {
        throw new Error("Stripe Checkout did not return a URL.");
      }
      return {
        id: session.id,
        url: session.url,
        expiresAt: new Date((session.expires_at ?? 0) * 1000),
      };
    },
    async createPortalSession(input) {
      const stripe = getStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
    async retrieveSubscription(id) {
      const stripe = getStripeClient();
      try {
        const subscription = await stripe.subscriptions.retrieve(id);
        return mapStripeSubscription(subscription);
      } catch {
        return null;
      }
    },
    async retrieveCheckoutSession(sessionId) {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return {
        id: session.id,
        url: session.url ?? null,
        customerId:
          typeof session.customer === "string"
            ? session.customer
            : (session.customer?.id ?? null),
        subscriptionId:
          typeof session.subscription === "string"
            ? session.subscription
            : (session.subscription?.id ?? null),
        status: session.status ?? "open",
      };
    },
    async cancelSubscription(providerSubscriptionId) {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(providerSubscriptionId);
    },
    async verifyWebhook(payload, signature) {
      if (!signature) {
        throw new Error("Missing Stripe-Signature header.");
      }
      const config = getBillingConfig();
      const stripe = getStripeClient();
      let lastError: unknown;
      for (const secret of config.webhookSecrets) {
        try {
          const event = await stripe.webhooks.constructEventAsync(
            payload,
            signature,
            secret,
          );
          return {
            id: event.id,
            type: event.type,
            created: new Date(event.created * 1000),
            livemode: event.livemode,
            data: event.data.object,
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("Stripe webhook signature verification failed.");
    },
  };
}
