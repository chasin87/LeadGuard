import Link from "next/link";
import { AnalyticsMappingForm } from "@/components/analytics-mapping-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getAnalyticsSetupOverview } from "@/server/google-ads/analytics-config";

export const metadata = { title: "Revenue analytics setup" };

export default async function GoogleAdsAnalyticsSetupPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );
  const overview = await getAnalyticsSetupOverview(user.id, organizationSlug);

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/integrations/google-ads`}
        >
          Google Ads
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Revenue analytics
      </h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Map a website to a Google Ads advertiser account. Analytics is read-only
        and does not require Data Manager conversion feedback.
      </p>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        {canManage ? (
          <AnalyticsMappingForm
            configs={overview.configs}
            customers={overview.customers.map((customer) => ({
              id: customer.id,
              descriptiveName: customer.descriptiveName,
            }))}
            organizationSlug={organizationSlug}
            suggestedCustomerByWebsite={overview.suggestedCustomerByWebsite}
            websites={overview.websites}
          />
        ) : (
          <p>Only owners and admins can change analytics mapping.</p>
        )}
      </section>
    </div>
  );
}
