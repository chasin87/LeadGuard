import Link from "next/link";
import { MonitorCreateForm } from "@/components/monitor-create-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { WebsiteNotFoundError } from "@/server/security/errors";
import { getWebsite } from "@/server/websites/service";
import { getMonitoringConfig } from "@/server/monitoring/config";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import { getFormMonitoringConfig } from "@/server/monitoring/form/config";
import { notFound } from "next/navigation";

export const metadata = { title: "Add monitor" };

export default async function NewMonitorPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; websiteId: string }>;
}) {
  const { organizationSlug, websiteId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;

  let website;
  try {
    website = await getWebsite(user.id, organizationSlug, websiteId);
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) notFound();
    throw error;
  }

  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "monitors:manage",
  );
  const config = getMonitoringConfig();
  const browserConfig = getBrowserMonitoringConfig();
  const formConfig = getFormMonitoringConfig();

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/websites/${website.id}`}
        >
          {website.name}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Add monitor</h1>
      {canManage ? (
        <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <MonitorCreateForm
            organizationSlug={organizationSlug}
            websiteId={website.id}
            defaultUrl={`${website.normalizedUrl}/`}
            httpIntervals={[...config.allowedIntervals]}
            browserIntervals={[...browserConfig.allowedIntervals]}
            formIntervals={[...formConfig.allowedIntervals]}
            defaultHttpIntervalSeconds={config.defaultIntervalSeconds}
            defaultBrowserIntervalSeconds={browserConfig.defaultIntervalSeconds}
            defaultFormIntervalSeconds={formConfig.defaultIntervalSeconds}
            defaultHttpTimeoutMs={config.defaultTimeoutMs}
            defaultBrowserTimeoutMs={browserConfig.defaultTimeoutMs}
            defaultFormTimeoutMs={formConfig.defaultTimeoutMs}
          />
        </section>
      ) : (
        <p className="mt-4 text-[var(--muted)]">
          Only owners and admins can add monitors.
        </p>
      )}
    </div>
  );
}
