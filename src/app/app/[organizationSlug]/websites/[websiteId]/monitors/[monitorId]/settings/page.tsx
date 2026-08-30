import Link from "next/link";
import { notFound } from "next/navigation";
import { MonitorDeleteForm } from "@/components/monitor-delete-form";
import { MonitorSettingsForm } from "@/components/monitor-settings-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import {
  MonitorNotFoundError,
  WebsiteNotFoundError,
} from "@/server/security/errors";
import { getMonitor } from "@/server/monitors/service";
import { getMonitoringConfig } from "@/server/monitoring/config";
import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import { getFormMonitoringConfig } from "@/server/monitoring/form/config";
import { FormMonitorSettingsForm } from "@/components/form-monitor-settings-form";
import { FormReceiptSettingsForm } from "@/components/form-receipt-settings-form";
import { listFormTestProfiles } from "@/server/form-profiles/service";
import { getServerEnvironment } from "@/lib/env";
import {
  getReceiptConfig,
  inboundReceiptAddressTemplate,
} from "@/server/receipts/config";

export const metadata = { title: "Monitor settings" };

export default async function MonitorSettingsPage({
  params,
}: {
  params: Promise<{
    organizationSlug: string;
    websiteId: string;
    monitorId: string;
  }>;
}) {
  const { organizationSlug, websiteId, monitorId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;

  let monitor;
  try {
    monitor = await getMonitor(user.id, organizationSlug, websiteId, monitorId);
  } catch (error) {
    if (
      error instanceof MonitorNotFoundError ||
      error instanceof WebsiteNotFoundError
    ) {
      notFound();
    }
    throw error;
  }

  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "monitors:manage",
  );
  const config = getMonitoringConfig();
  const browserConfig = getBrowserMonitoringConfig();
  const formConfig = getFormMonitoringConfig();
  const receiptConfig = getReceiptConfig();
  const appUrl = getServerEnvironment().APP_URL.replace(/\/$/, "");
  const allowedIntervals =
    monitor.type === "FORM"
      ? [...formConfig.allowedIntervals]
      : monitor.type === "BROWSER"
        ? [...browserConfig.allowedIntervals]
        : [...config.allowedIntervals];
  const profiles =
    monitor.type === "FORM"
      ? await listFormTestProfiles(user.id, organizationSlug)
      : [];
  const detailHref = `/app/${organizationSlug}/websites/${websiteId}/monitors/${monitor.id}`;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={detailHref}
        >
          {monitor.name}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Settings</h1>
      {canManage ? (
        <>
          <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
            {monitor.type === "FORM" && monitor.formConfig ? (
              <FormMonitorSettingsForm
                organizationSlug={organizationSlug}
                websiteId={websiteId}
                monitorId={monitor.id}
                name={monitor.name}
                url={monitor.normalizedUrl}
                intervalSeconds={monitor.intervalSeconds}
                timeoutMs={monitor.timeoutMs}
                status={monitor.status}
                consecutiveFailuresBeforeIncident={
                  monitor.consecutiveFailuresBeforeIncident
                }
                allowedIntervals={allowedIntervals}
                viewport={monitor.formConfig.viewport}
                formSelector={monitor.formConfig.formSelector}
                submitSelector={monitor.formConfig.submitSelector}
                cookieAcceptSelector={monitor.formConfig.cookieAcceptSelector}
                fieldMappings={
                  Array.isArray(monitor.formConfig.fieldMappings)
                    ? (
                        monitor.formConfig.fieldMappings as Array<
                          Record<string, string>
                        >
                      ).map((item) => ({
                        role: item.role ?? "CUSTOM",
                        control: item.control ?? "TEXT",
                        selector: item.selector ?? "",
                        label: item.label ?? "",
                        value: item.value ?? "",
                      }))
                    : []
                }
                successMode={monitor.formConfig.successMode}
                successSelector={monitor.formConfig.successSelector}
                successUrlPattern={monitor.formConfig.successUrlPattern}
                successText={monitor.formConfig.successText}
                submissionTimeoutMs={monitor.formConfig.submissionTimeoutMs}
                testProfileId={monitor.formConfig.testProfileId}
                profiles={profiles.map((profile) => ({
                  id: profile.id,
                  name: profile.name,
                }))}
              />
            ) : (
              <MonitorSettingsForm
                organizationSlug={organizationSlug}
                websiteId={websiteId}
                monitorId={monitor.id}
                type={monitor.type === "BROWSER" ? "BROWSER" : "HTTP"}
                name={monitor.name}
                url={monitor.normalizedUrl}
                intervalSeconds={monitor.intervalSeconds}
                timeoutMs={monitor.timeoutMs}
                status={monitor.status}
                consecutiveFailuresBeforeIncident={
                  monitor.consecutiveFailuresBeforeIncident
                }
                allowedIntervals={allowedIntervals}
                viewport={monitor.browserConfig?.viewport}
                requiredSelector={monitor.browserConfig?.requiredSelector}
                requiredElementName={monitor.browserConfig?.requiredElementName}
                urlLocked={monitor.type === "AD_DESTINATION"}
              />
            )}
          </section>
          {monitor.type === "FORM" && monitor.formConfig ? (
            <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
              <h2 className="text-lg font-bold">Lead receipt verification</h2>
              <div className="mt-4">
                <FormReceiptSettingsForm
                  organizationSlug={organizationSlug}
                  websiteId={websiteId}
                  monitorId={monitor.id}
                  receiptMode={monitor.formConfig.receiptMode}
                  receiptTimeoutMinutes={
                    monitor.formConfig.receiptTimeoutMinutes
                  }
                  receiptVerified={Boolean(
                    monitor.formConfig.receiptVerifiedAt,
                  )}
                  inboundReady={receiptConfig.inboundSelectable}
                  inboundTemplate={inboundReceiptAddressTemplate()}
                  webhookPrefix={monitor.formConfig.receiptWebhookSecretPrefix}
                  webhookEndpoint={`${appUrl}/api/receipts/webhook`}
                />
              </div>
            </section>
          ) : null}
          <section className="mt-8 max-w-xl rounded-2xl border border-red-200 bg-white p-6">
            <h2 className="text-lg font-bold">Delete monitor</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              The monitor is archived and no longer scheduled. Existing check
              history is kept for later incident analysis.
            </p>
            <div className="mt-5">
              <MonitorDeleteForm
                organizationSlug={organizationSlug}
                websiteId={websiteId}
                monitorId={monitor.id}
                name={monitor.name}
              />
            </div>
          </section>
        </>
      ) : (
        <p className="mt-4 text-[var(--muted)]">
          Only owners and admins can change monitor settings.
        </p>
      )}
    </div>
  );
}
