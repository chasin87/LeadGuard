import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getCheckoutConfirmation } from "@/server/billing/queries";
import { BillingConfirmPoller } from "@/components/billing-confirm-poller";
import Link from "next/link";

export const metadata = { title: "Confirming subscription" };

export default async function BillingConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { organizationSlug } = await params;
  const { session_id: sessionId } = await searchParams;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const confirmation = await getCheckoutConfirmation(
    user.id,
    organizationSlug,
    sessionId ?? null,
  );
  const confirmed =
    confirmation.subscription?.provider !== "INTERNAL" &&
    confirmation.entitlements.status === "ACTIVE";

  return (
    <div className="px-5 py-10 lg:px-10">
      <BillingConfirmPoller confirmed={confirmed} />
      <h1 className="text-3xl font-bold tracking-tight">
        {confirmed
          ? "Subscription confirmed"
          : "We're confirming your subscription…"}
      </h1>
      <p className="mt-4 max-w-xl text-[var(--muted)]">
        {confirmed
          ? `${confirmation.entitlements.planName} is now active for this organization.`
          : "Checkout success is not enough on its own. LeadGuard waits for the verified billing webhook before activating access."}
      </p>
      <p className="mt-6">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/settings/billing`}
        >
          Back to billing
        </Link>
      </p>
    </div>
  );
}
