import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createStripeBillingProvider } from "./stripe";

describe("Stripe webhook verification", () => {
  const previous = {
    secret: process.env.STRIPE_SECRET_KEY,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
    provider: process.env.BILLING_PROVIDER,
  };

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = previous.secret;
    process.env.STRIPE_WEBHOOK_SECRET = previous.webhook;
    process.env.BILLING_PROVIDER = previous.provider;
  });

  it("accepts a valid signature and rejects a tampered body", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_leadguard_webhook";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_leadguard_test";
    process.env.BILLING_PROVIDER = "stripe";
    const payload = JSON.stringify({
      id: "evt_test_1",
      object: "event",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
      created: Math.floor(Date.now() / 1000),
      livemode: false,
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_leadguard_test",
    });
    const provider = createStripeBillingProvider();
    const event = await provider.verifyWebhook(payload, signature);
    expect(event.id).toBe("evt_test_1");
    await expect(
      provider.verifyWebhook(`${payload} `, signature),
    ).rejects.toBeTruthy();
    await expect(
      provider.verifyWebhook(payload, "t=1,v1=deadbeef"),
    ).rejects.toBeTruthy();
  });
});
