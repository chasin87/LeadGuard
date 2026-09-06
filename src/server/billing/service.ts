import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { BillingPlanKey } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";
import {
  getBillingConfig,
  stripePriceIdForPlan,
} from "@/server/billing/config";
import { isSellablePlanKey } from "@/server/billing/catalog";
import { getBillingProvider } from "@/server/billing/clients";
import { lockOrganizationBilling } from "@/server/billing/lock";
import { fakePriceEnv } from "@/server/billing/fake";

const logger = createLogger("billing");

async function audit(input: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  planKey?: string | null;
  providerEventId?: string | null;
}) {
  await database.billingAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      planKey: input.planKey ?? null,
      providerEventId: input.providerEventId ?? null,
    },
  });
}

export async function startOrganizationTrial(input: {
  organizationId: string;
  ownerUserId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const config = getBillingConfig();
  const owner = await database.user.findUnique({
    where: { id: input.ownerUserId },
    select: { trialConsumedAt: true },
  });
  if (owner?.trialConsumedAt) return;
  const trialEnd = new Date(now.getTime() + config.trialDays * 86_400_000);
  try {
    await database.$transaction(async (tx) => {
      await lockOrganizationBilling(tx, input.organizationId);
      const existing = await tx.billingSubscription.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (existing) return;
      await tx.billingSubscription.create({
        data: {
          organizationId: input.organizationId,
          provider: "INTERNAL",
          providerSubscriptionId: `trial:${input.organizationId}`,
          planKey: "GROWTH",
          status: "TRIALING",
          providerStatus: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
          trialStart: now,
          trialEnd,
        },
      });
      await tx.user.update({
        where: { id: input.ownerUserId },
        data: { trialConsumedAt: now },
      });
    });
    logger.info("billing.subscription.activated", {
      organizationId: input.organizationId,
      planKey: "GROWTH",
    });
    await audit({
      organizationId: input.organizationId,
      actorUserId: input.ownerUserId,
      action: "trial.started",
      planKey: "GROWTH",
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

export async function createCheckoutSession(input: {
  userId: string;
  organizationSlug: string;
  planKey: string;
}) {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "billing:manage",
  );
  if (!isSellablePlanKey(input.planKey)) {
    throw new DomainError("Choose a valid LeadGuard plan.");
  }
  const planKey = input.planKey as BillingPlanKey;
  const config = getBillingConfig();
  const env =
    config.provider === "fake"
      ? { ...process.env, ...fakePriceEnv() }
      : process.env;
  const priceId = stripePriceIdForPlan(planKey, env);
  if (!priceId) {
    throw new DomainError("This plan is not configured for checkout yet.");
  }
  const provider = getBillingProvider();
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  return database.$transaction(async (tx) => {
    await lockOrganizationBilling(tx, context.organization.id);
    const open = await tx.billingCheckoutSession.findFirst({
      where: {
        organizationId: context.organization.id,
        planKey,
        status: "OPEN",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (open) {
      const existing = await provider.retrieveCheckoutSession(
        open.providerSessionId,
      );
      if (existing && existing.status === "open") {
        const url =
          existing.url ??
          (config.provider === "fake"
            ? `/api/billing/fake/checkout?session=${encodeURIComponent(open.providerSessionId)}`
            : null);
        if (url) {
          return { url, sessionId: open.providerSessionId };
        }
      }
    }

    let customer = await tx.billingCustomer.findUnique({
      where: { organizationId: context.organization.id },
    });
    if (!customer) {
      const created = await provider.createCustomer({
        organizationId: context.organization.id,
        email: context.user.email,
        name: context.organization.name,
      });
      try {
        customer = await tx.billingCustomer.create({
          data: {
            organizationId: context.organization.id,
            provider: config.provider === "stripe" ? "STRIPE" : "FAKE",
            providerCustomerId: created.providerCustomerId,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          customer = await tx.billingCustomer.findUniqueOrThrow({
            where: { organizationId: context.organization.id },
          });
        } else {
          throw error;
        }
      }
    }

    const idempotencyKey = `checkout:${context.organization.id}:${planKey}`;
    const session = await provider.createCheckoutSession({
      organizationId: context.organization.id,
      customerId: customer.providerCustomerId,
      planKey,
      priceId,
      successUrl: `${appUrl}/app/${context.organization.slug}/settings/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/app/${context.organization.slug}/settings/billing`,
      idempotencyKey,
    });
    await tx.billingCheckoutSession.upsert({
      where: { idempotencyKey },
      create: {
        organizationId: context.organization.id,
        billingCustomerId: customer.id,
        planKey,
        provider: config.provider === "stripe" ? "STRIPE" : "FAKE",
        providerSessionId: session.id,
        status: "OPEN",
        idempotencyKey,
        expiresAt: session.expiresAt,
        createdByUserId: input.userId,
      },
      update: {
        providerSessionId: session.id,
        status: "OPEN",
        expiresAt: session.expiresAt,
      },
    });
    logger.info("billing.checkout.created", {
      organizationId: context.organization.id,
      planKey,
    });
    await tx.billingAuditEvent.create({
      data: {
        organizationId: context.organization.id,
        actorUserId: input.userId,
        action: "checkout.created",
        planKey,
      },
    });
    return { url: session.url, sessionId: session.id };
  });
}

export async function createPortalSession(input: {
  userId: string;
  organizationSlug: string;
}) {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "billing:manage",
  );
  const customer = await database.billingCustomer.findUnique({
    where: { organizationId: context.organization.id },
  });
  if (!customer) {
    throw new DomainError(
      "No billing customer exists yet. Choose a plan first.",
    );
  }
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const session = await getBillingProvider().createPortalSession({
    customerId: customer.providerCustomerId,
    returnUrl: `${appUrl}/app/${context.organization.slug}/settings/billing`,
  });
  await audit({
    organizationId: context.organization.id,
    actorUserId: input.userId,
    action: "portal.created",
  });
  return session;
}

export async function refreshBillingStatus(input: {
  userId: string;
  organizationSlug: string;
}) {
  const context = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "billing:manage",
  );
  const subscription = await database.billingSubscription.findUnique({
    where: { organizationId: context.organization.id },
  });
  if (!subscription || subscription.provider === "INTERNAL") return;
  const remote = await getBillingProvider().retrieveSubscription(
    subscription.providerSubscriptionId,
  );
  if (!remote) return;
  const { projectProviderSubscription } =
    await import("@/server/billing/projection");
  await projectProviderSubscription({
    subscription: remote,
    eventCreatedAt: new Date(),
    organizationId: context.organization.id,
  });
}
