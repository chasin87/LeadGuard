import type { BillingPlanKey } from "@/generated/prisma/enums";

export type BillingCustomerRecord = {
  id: string;
  organizationId: string;
  providerCustomerId: string;
};

export type CheckoutSessionResult = {
  id: string;
  url: string;
  expiresAt: Date;
};

export type PortalSessionResult = {
  url: string;
};

export type ProviderSubscription = {
  id: string;
  customerId: string;
  status: string;
  priceId: string | null;
  quantity: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  created: Date;
};

export type VerifiedBillingEvent = {
  id: string;
  type: string;
  created: Date;
  livemode: boolean;
  data: unknown;
};

export interface BillingProvider {
  createCustomer(input: {
    organizationId: string;
    email?: string | null;
    name?: string | null;
  }): Promise<{ providerCustomerId: string }>;
  createCheckoutSession(input: {
    organizationId: string;
    customerId: string;
    planKey: BillingPlanKey;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<CheckoutSessionResult>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<PortalSessionResult>;
  retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null>;
  retrieveCheckoutSession(sessionId: string): Promise<{
    id: string;
    url: string | null;
    customerId: string | null;
    subscriptionId: string | null;
    status: string;
  } | null>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
}

export type BillingProviderModule = BillingProvider & {
  verifyWebhook?(
    payload: string,
    signature: string | null,
  ): Promise<VerifiedBillingEvent>;
};
