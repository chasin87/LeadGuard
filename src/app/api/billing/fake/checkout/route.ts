import { NextRequest } from "next/server";
import {
  getBillingConfig,
  stripePriceIdForPlan,
} from "@/server/billing/config";
import { createFakeBillingProvider, fakePriceEnv } from "@/server/billing/fake";
import { applyVerifiedBillingEvent } from "@/server/billing/projection";
import { database } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function htmlPage(sessionId: string) {
  const encoded = encodeURIComponent(sessionId);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fake Stripe Checkout</title>
  </head>
  <body>
    <h1>Confirm LeadGuard subscription</h1>
    <p>This is the local fake Checkout provider. No card is collected.</p>
    <p>
      <a href="/api/billing/fake/checkout?session=${encoded}&amp;approve=1">Approve and continue</a>
    </p>
  </body>
</html>`;
}

async function completeFakeCheckout(sessionId: string) {
  const fake = createFakeBillingProvider();
  const existing = await fake.retrieveCheckoutSession(sessionId);
  if (!existing) {
    const row = await database.billingCheckoutSession.findUnique({
      where: { providerSessionId: sessionId },
    });
    if (!row) {
      return new Response("Unknown checkout session", { status: 404 });
    }
    const customer = row.billingCustomerId
      ? await database.billingCustomer.findUnique({
          where: { id: row.billingCustomerId },
        })
      : await database.billingCustomer.findUnique({
          where: { organizationId: row.organizationId },
        });
    if (!customer) {
      return new Response("Unknown billing customer", { status: 404 });
    }
    const priceId =
      stripePriceIdForPlan(row.planKey, {
        ...process.env,
        ...fakePriceEnv(),
      }) ?? `price_fake_${row.planKey.toLowerCase()}`;
    fake.hydrateCheckout({
      id: sessionId,
      organizationId: row.organizationId,
      customerId: customer.providerCustomerId,
      planKey: row.planKey,
      priceId,
    });
  }
  const event = fake.completeCheckout(sessionId);
  await applyVerifiedBillingEvent(event);
  await database.billingCheckoutSession.updateMany({
    where: { providerSessionId: sessionId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  const checkout = await fake.retrieveCheckoutSession(sessionId);
  const customer = checkout?.customerId
    ? await database.billingCustomer.findUnique({
        where: { providerCustomerId: checkout.customerId },
      })
    : null;
  const organization = customer
    ? await database.organization.findUnique({
        where: { id: customer.organizationId },
      })
    : null;
  const dest = organization
    ? `/app/${organization.slug}/settings/billing/confirm?session_id=${encodeURIComponent(sessionId)}`
    : "/app";
  return new Response(null, {
    status: 303,
    headers: { Location: dest },
  });
}

export async function GET(request: NextRequest) {
  if (getBillingConfig().provider !== "fake") {
    return new Response("Not found", { status: 404 });
  }
  const sessionId = request.nextUrl.searchParams.get("session") ?? "";
  if (request.nextUrl.searchParams.get("approve") === "1") {
    return completeFakeCheckout(sessionId);
  }
  return new Response(htmlPage(sessionId), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  if (getBillingConfig().provider !== "fake") {
    return new Response("Not found", { status: 404 });
  }
  const form = await request.formData();
  const sessionId = decodeURIComponent(String(form.get("session") ?? ""));
  return completeFakeCheckout(sessionId);
}
