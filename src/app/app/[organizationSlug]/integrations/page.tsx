import Link from "next/link";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { unmatchedOutcomeCount } from "@/server/outcomes/queries";

export const metadata = { title: "Integrations" };

export default async function IntegrationsHubPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const unmatched = await unmatchedOutcomeCount(access.context.organization.id);

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Connect advertising accounts and send lead outcomes from your CRM or
        files. Native CRM connectors are not included yet.
      </p>
      <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
        <Link
          aria-label="Google Ads"
          className="rounded-2xl border border-[var(--border)] bg-white p-6 hover:border-[#19d0a2]"
          data-testid="integration-google-ads"
          href={`/app/${organizationSlug}/integrations/google-ads`}
        >
          <h2 className="text-lg font-bold">Google Ads</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Read-only destination monitoring, spend-at-risk, and optional
            conversion feedback.
          </p>
        </Link>
        <Link
          aria-label="Outcome ingestion"
          className="rounded-2xl border border-[var(--border)] bg-white p-6 hover:border-[#19d0a2]"
          data-testid="integration-outcomes"
          href={`/app/${organizationSlug}/integrations/outcomes`}
        >
          <h2 className="text-lg font-bold">Outcome ingestion</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            API, webhook and CSV/XLSX updates for existing leads.
          </p>
          {unmatched > 0 ? (
            <p className="mt-3 text-sm font-semibold text-amber-800">
              Unmatched outcome events {unmatched}
            </p>
          ) : null}
        </Link>
      </div>
    </div>
  );
}
