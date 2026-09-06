import { NextRequest } from "next/server";
import { getBillingConfig } from "@/server/billing/config";
import { requireUser } from "@/server/authorization/session";
import { database } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (getBillingConfig().provider !== "fake") {
    return new Response("Not found", { status: 404 });
  }
  await requireUser();
  const customerId = request.nextUrl.searchParams.get("customer") ?? "";
  const customer = await database.billingCustomer.findUnique({
    where: { providerCustomerId: customerId },
  });
  const dest = customer
    ? `/app/${(await database.organization.findUniqueOrThrow({ where: { id: customer.organizationId } })).slug}/settings/billing`
    : "/app";
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fake Stripe Customer Portal</title>
  </head>
  <body>
    <h1>Fake Customer Portal</h1>
    <p>Payment methods and invoices are managed in Stripe. This local stand-in does not collect cards.</p>
    <p><a href="${dest}">Return to LeadGuard billing</a></p>
  </body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
