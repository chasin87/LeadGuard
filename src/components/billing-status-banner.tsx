import Link from "next/link";
import { billingBanner } from "@/server/billing/access";
import type { OrganizationEntitlements } from "@/server/billing/entitlements";

export function BillingStatusBanner({
  organizationSlug,
  entitlements,
  canManage,
}: {
  organizationSlug: string;
  entitlements: OrganizationEntitlements;
  canManage: boolean;
}) {
  const banner = billingBanner(entitlements);
  if (!banner) return null;
  const tone =
    banner.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-900"
      : banner.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-emerald-200 bg-emerald-50 text-emerald-950";
  return (
    <div
      className={`border-b px-5 py-3 text-sm ${tone}`}
      data-testid="billing-banner"
      role="status"
    >
      <span>{banner.message}</span>{" "}
      {canManage ? (
        <Link
          className="font-semibold underline"
          href={`/app/${organizationSlug}/settings/billing`}
        >
          View billing
        </Link>
      ) : null}
    </div>
  );
}
