import type {
  BillingPlanKey,
  BillingSubscriptionStatus,
} from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import {
  getBillingConfig,
  planKeyForStripePriceId,
  fakePriceEnv,
} from "@/server/billing/config";
import type {
  ProviderSubscription,
  VerifiedBillingEvent,
} from "@/server/billing/provider";
import { getBillingProvider } from "@/server/billing/clients";

const logger = createLogger("billing");

export function mapProviderStatus(status: string): BillingSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
    case "paused":
      return "SUSPENDED";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    default:
      return "NEEDS_REVIEW";
  }
}

export async function projectProviderSubscription(input: {
  subscription: ProviderSubscription;
  eventCreatedAt: Date;
  organizationId?: string | null;
}) {
  const customer = await database.billingCustomer.findUnique({
    where: { providerCustomerId: input.subscription.customerId },
  });
  const organizationId = customer?.organizationId ?? input.organizationId;
  if (!organizationId) {
    logger.warn("billing.webhook.unmapped_customer", {
      type: "subscription",
    });
    return;
  }
  const existing = await database.billingSubscription.findUnique({
    where: { organizationId },
  });
  if (
    existing?.lastStripeEventAt &&
    input.eventCreatedAt < existing.lastStripeEventAt
  ) {
    logger.info("billing.webhook.stale_event_ignored", {
      organizationId,
    });
    return;
  }
  const config = getBillingConfig();
  const priceEnv =
    config.provider === "fake"
      ? { ...process.env, ...fakePriceEnv() }
      : process.env;
  const planKey: BillingPlanKey | null = input.subscription.priceId
    ? planKeyForStripePriceId(input.subscription.priceId, priceEnv)
    : (existing?.planKey ?? null);
  const status = mapProviderStatus(input.subscription.status);
  const resolvedPlan = planKey ?? "NEEDS_REVIEW";
  const resolvedStatus: BillingSubscriptionStatus =
    planKey === null && status === "ACTIVE" ? "NEEDS_REVIEW" : status;
  let graceDeadlineAt = existing?.graceDeadlineAt ?? null;
  if (resolvedStatus === "PAST_DUE") {
    graceDeadlineAt ??= new Date(Date.now() + config.graceDays * 86_400_000);
  }
  if (resolvedStatus === "ACTIVE" || resolvedStatus === "TRIALING") {
    graceDeadlineAt = null;
  }

  await database.billingSubscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      billingCustomerId: customer?.id,
      provider: customer?.provider ?? "STRIPE",
      providerSubscriptionId: input.subscription.id,
      planKey: resolvedPlan === "NEEDS_REVIEW" ? "STARTER" : resolvedPlan,
      status: resolvedStatus,
      providerStatus: input.subscription.status,
      currentPeriodStart: input.subscription.currentPeriodStart,
      currentPeriodEnd: input.subscription.currentPeriodEnd,
      trialStart: input.subscription.trialStart,
      trialEnd: input.subscription.trialEnd,
      graceDeadlineAt,
      cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd,
      canceledAt: input.subscription.canceledAt,
      endedAt: input.subscription.endedAt,
      priceId: input.subscription.priceId,
      quantity: input.subscription.quantity,
      lastStripeEventAt: input.eventCreatedAt,
    },
    update: {
      billingCustomerId: customer?.id,
      provider: customer?.provider ?? existing?.provider ?? "STRIPE",
      providerSubscriptionId: input.subscription.id,
      planKey:
        resolvedPlan === "NEEDS_REVIEW" ? existing?.planKey : resolvedPlan,
      status: resolvedStatus,
      providerStatus: input.subscription.status,
      currentPeriodStart: input.subscription.currentPeriodStart,
      currentPeriodEnd: input.subscription.currentPeriodEnd,
      trialStart: input.subscription.trialStart,
      trialEnd: input.subscription.trialEnd,
      graceDeadlineAt,
      cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd,
      canceledAt: input.subscription.canceledAt,
      endedAt: input.subscription.endedAt,
      priceId: input.subscription.priceId,
      quantity: input.subscription.quantity,
      lastStripeEventAt: input.eventCreatedAt,
    },
  });
  logger.info("billing.subscription.updated", {
    organizationId,
    status: resolvedStatus,
    planKey: resolvedPlan,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function subscriptionFromEventData(data: unknown): ProviderSubscription | null {
  const record = asRecord(data);
  if (!record) return null;
  if (typeof record.id === "string" && typeof record.customerId === "string") {
    return data as ProviderSubscription;
  }
  if (record.object === "subscription" && typeof record.id === "string") {
    const items = asRecord(record.items);
    const itemList = Array.isArray(items?.data) ? items.data : [];
    const first = asRecord(itemList[0]);
    const price = asRecord(first?.price);
    const start =
      typeof first?.current_period_start === "number"
        ? first.current_period_start
        : typeof record.start_date === "number"
          ? record.start_date
          : 0;
    const end =
      typeof first?.current_period_end === "number"
        ? first.current_period_end
        : start;
    const customer =
      typeof record.customer === "string"
        ? record.customer
        : asRecord(record.customer)?.id;
    if (typeof customer !== "string") return null;
    return {
      id: record.id,
      customerId: customer,
      status: String(record.status ?? "active"),
      priceId: typeof price?.id === "string" ? price.id : null,
      quantity: typeof first?.quantity === "number" ? first.quantity : 1,
      currentPeriodStart: new Date(start * 1000),
      currentPeriodEnd: new Date(end * 1000),
      trialStart:
        typeof record.trial_start === "number"
          ? new Date(record.trial_start * 1000)
          : null,
      trialEnd:
        typeof record.trial_end === "number"
          ? new Date(record.trial_end * 1000)
          : null,
      cancelAtPeriodEnd: Boolean(record.cancel_at_period_end),
      canceledAt:
        typeof record.canceled_at === "number"
          ? new Date(record.canceled_at * 1000)
          : null,
      endedAt:
        typeof record.ended_at === "number"
          ? new Date(record.ended_at * 1000)
          : null,
      created: new Date(
        (typeof record.created === "number" ? record.created : 0) * 1000,
      ),
    };
  }
  return null;
}

export async function applyVerifiedBillingEvent(event: VerifiedBillingEvent) {
  const existing = await database.billingProviderEvent.findUnique({
    where: { providerEventId: event.id },
  });
  if (existing?.status === "PROCESSED" || existing?.status === "IGNORED") {
    return existing;
  }
  const stored = existing
    ? existing
    : await database.billingProviderEvent
        .create({
          data: {
            provider:
              getBillingConfig().provider === "stripe" ? "STRIPE" : "FAKE",
            providerEventId: event.id,
            type: event.type,
            eventCreatedAt: event.created,
            status: "RECEIVED",
          },
        })
        .catch(async (error: unknown) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return database.billingProviderEvent.findUniqueOrThrow({
              where: { providerEventId: event.id },
            });
          }
          throw error;
        });
  if (stored.status === "PROCESSED" || stored.status === "IGNORED") {
    return stored;
  }

  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const mapped = subscriptionFromEventData(event.data);
      if (mapped) {
        if (event.type === "customer.subscription.deleted") {
          mapped.status = "canceled";
          mapped.endedAt = mapped.endedAt ?? event.created;
        }
        await projectProviderSubscription({
          subscription: mapped,
          eventCreatedAt: event.created,
        });
      }
    }
    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed"
    ) {
      const invoice = asRecord(event.data);
      const mapped = subscriptionFromEventData(event.data);
      const subscriptionId =
        typeof invoice?.subscription === "string"
          ? invoice.subscription
          : asRecord(invoice?.subscription)?.id;
      const customerId =
        typeof invoice?.customer === "string"
          ? invoice.customer
          : asRecord(invoice?.customer)?.id;
      if (mapped) {
        if (event.type === "invoice.payment_failed") {
          mapped.status =
            mapped.status === "active" ? "past_due" : mapped.status;
        }
        await projectProviderSubscription({
          subscription: mapped,
          eventCreatedAt: event.created,
        });
      } else if (typeof subscriptionId === "string") {
        const provider = getBillingProvider();
        const retrieved = await provider.retrieveSubscription(subscriptionId);
        if (retrieved) {
          if (event.type === "invoice.payment_failed") {
            retrieved.status =
              retrieved.status === "active" ? "past_due" : retrieved.status;
          }
          await projectProviderSubscription({
            subscription: retrieved,
            eventCreatedAt: event.created,
          });
        }
      } else if (typeof customerId === "string") {
        logger.info("billing.webhook.invoice_without_subscription", {
          type: event.type,
        });
      }
    }
    if (event.type === "checkout.session.completed") {
      const session = asRecord(event.data);
      const subscriptionId =
        typeof session?.subscription === "string"
          ? session.subscription
          : asRecord(session?.subscription)?.id;
      if (typeof subscriptionId === "string") {
        const retrieved =
          await getBillingProvider().retrieveSubscription(subscriptionId);
        if (retrieved) {
          await projectProviderSubscription({
            subscription: retrieved,
            eventCreatedAt: event.created,
            organizationId:
              typeof asRecord(session?.metadata)?.organizationId === "string"
                ? String(asRecord(session?.metadata)?.organizationId)
                : null,
          });
        }
      }
    }

    return database.billingProviderEvent.update({
      where: { id: stored.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (error) {
    await database.billingProviderEvent.update({
      where: { id: stored.id },
      data: {
        status: "FAILED",
        errorCode: error instanceof Error ? error.name : "ERROR",
      },
    });
    throw error;
  }
}

export async function reconcileBillingSubscriptions(now = new Date()) {
  const rows = await database.billingSubscription.findMany({
    where: {
      provider: { in: ["STRIPE", "FAKE"] },
      status: { notIn: ["CANCELED"] },
    },
    take: 200,
  });
  const provider = getBillingProvider();
  for (const row of rows) {
    if (
      row.status === "PAST_DUE" &&
      row.graceDeadlineAt &&
      now >= row.graceDeadlineAt
    ) {
      await database.billingSubscription.update({
        where: { id: row.id },
        data: { status: "SUSPENDED" },
      });
      logger.info("billing.subscription.suspended", {
        organizationId: row.organizationId,
      });
    }
    if (
      row.status === "TRIALING" &&
      row.trialEnd &&
      now >= row.trialEnd &&
      row.provider === "INTERNAL"
    ) {
      await database.billingSubscription.update({
        where: { id: row.id },
        data: { status: "TRIAL_EXPIRED" },
      });
      continue;
    }
    const remote = await provider.retrieveSubscription(
      row.providerSubscriptionId,
    );
    if (!remote) continue;
    await projectProviderSubscription({
      subscription: remote,
      eventCreatedAt: now,
    });
    await database.billingSubscription.update({
      where: { organizationId: row.organizationId },
      data: { lastReconciledAt: now },
    });
  }
}

export async function reconcileOrganizationBilling(
  organizationId: string,
  now = new Date(),
) {
  const row = await database.billingSubscription.findUnique({
    where: { organizationId },
  });
  if (!row) return;
  if (row.provider === "INTERNAL") {
    if (row.status === "TRIALING" && row.trialEnd && now >= row.trialEnd) {
      await database.billingSubscription.update({
        where: { id: row.id },
        data: { status: "TRIAL_EXPIRED", lastReconciledAt: now },
      });
    }
    return;
  }
  if (
    row.status === "PAST_DUE" &&
    row.graceDeadlineAt &&
    now >= row.graceDeadlineAt
  ) {
    await database.billingSubscription.update({
      where: { id: row.id },
      data: { status: "SUSPENDED" },
    });
  }
  const remote = await getBillingProvider().retrieveSubscription(
    row.providerSubscriptionId,
  );
  if (remote) {
    await projectProviderSubscription({
      subscription: remote,
      eventCreatedAt: now,
      organizationId,
    });
  }
  await database.billingSubscription.update({
    where: { organizationId },
    data: { lastReconciledAt: now },
  });
}
