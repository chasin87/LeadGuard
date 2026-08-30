import Link from "next/link";
import { notFound } from "next/navigation";
import { IncidentStatusBadge } from "@/components/incident-status-badge";
import { requireUser } from "@/server/authorization/session";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { IncidentNotFoundError } from "@/server/security/errors";
import {
  getOrganizationIncident,
  listIncidentTimelineChecks,
} from "@/server/incidents/service";
import { listIncidentDeliveries } from "@/server/notifications/queries";
import { NotificationDeliveryRetryForm } from "@/components/notification-delivery-retry-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import {
  checkErrorDetail,
  checkErrorLabel,
  checkStatusLabel,
} from "@/lib/monitoring/display";
import { formatDuration, incidentDurationMs } from "@/lib/incidents/duration";
import { getGoogleAdsContextForMonitor } from "@/server/google-ads/context";
import { GoogleAdsIncidentImpactCard } from "@/components/google-ads-incident-impact-card";
import { presentGoogleAdsImpact } from "@/server/google-ads/impact/presentation";

export const metadata = { title: "Incident" };

function formatStamp(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function timelineLabel(
  checkId: string,
  status: "SUCCESS" | "DEGRADED" | "FAILURE",
  incident: {
    firstFailedCheckId: string | null;
    recoveryCheckId: string | null;
    detectedAt: Date;
    startedAt: Date;
  },
  finishedAt: Date,
) {
  if (incident.recoveryCheckId === checkId) return "Recovered";
  if (
    incident.firstFailedCheckId === checkId &&
    finishedAt.getTime() === incident.detectedAt.getTime()
  ) {
    return "Incident detected";
  }
  if (incident.firstFailedCheckId === checkId) return "First failure";
  if (finishedAt.getTime() === incident.detectedAt.getTime()) {
    return "Incident detected";
  }
  if (status === "FAILURE") return "Still failing";
  return checkStatusLabel(status);
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; incidentId: string }>;
}) {
  const { organizationSlug, incidentId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;

  let incident;
  try {
    incident = await getOrganizationIncident(
      user.id,
      organizationSlug,
      incidentId,
    );
  } catch (error) {
    if (error instanceof IncidentNotFoundError) notFound();
    throw error;
  }

  const checks = await listIncidentTimelineChecks(
    user.id,
    organizationSlug,
    incidentId,
  );
  const deliveries = await listIncidentDeliveries(
    user.id,
    organizationSlug,
    incidentId,
  );
  const canManageNotifications = hasOrganizationPermission(
    access.context.membership.role,
    "notifications:manage",
  );
  const adsContext = await getGoogleAdsContextForMonitor(incident.monitor.id);
  const canManageIntegrations = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );
  const impactView = incident.googleAdsIncidentImpact
    ? presentGoogleAdsImpact({
        status: incident.googleAdsIncidentImpact.status,
        attributionMethod: incident.googleAdsIncidentImpact.attributionMethod,
        confidence: incident.googleAdsIncidentImpact.confidence,
        isProvisional: incident.googleAdsIncidentImpact.isProvisional,
        dataIncomplete: incident.googleAdsIncidentImpact.dataIncomplete,
        currencyCode: incident.googleAdsIncidentImpact.currencyCode,
        windowCostMicros: incident.googleAdsIncidentImpact.windowCostMicros,
        windowClicksMilli: incident.googleAdsIncidentImpact.windowClicksMilli,
        windowClicksEstimated:
          incident.googleAdsIncidentImpact.windowClicksEstimated,
        destinationDailyCostMicros:
          incident.googleAdsIncidentImpact.destinationDailyCostMicros,
        destinationDailyFrom:
          incident.googleAdsIncidentImpact.destinationDailyFrom,
        destinationDailyTo: incident.googleAdsIncidentImpact.destinationDailyTo,
        totalRelevantSources:
          incident.googleAdsIncidentImpact.totalRelevantSources,
        attributedSources: incident.googleAdsIncidentImpact.attributedSources,
        lastRefreshedAt: incident.googleAdsIncidentImpact.lastRefreshedAt,
        dataThrough: incident.googleAdsIncidentImpact.dataThrough,
        diagnosticCode: incident.googleAdsIncidentImpact.diagnosticCode,
      })
    : null;
  const websiteHref = `/app/${organizationSlug}/websites/${incident.monitor.website.id}`;
  const monitorHref = `${websiteHref}/monitors/${incident.monitor.id}`;
  const pausedOpen =
    incident.status === "OPEN" &&
    (incident.monitor.status === "PAUSED" ||
      incident.monitor.deletedAt != null ||
      incident.monitor.website.status === "DISABLED");

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/incidents`}
        >
          Incidents
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {incident.monitor.name}
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            {incident.monitor.website.name}
          </p>
        </div>
        <IncidentStatusBadge status={incident.status} />
      </div>

      {pausedOpen ? (
        <p className="mt-4 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Monitoring paused while incident is open. Recovery cannot be confirmed
          until monitoring resumes.
        </p>
      ) : null}

      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--muted)]">Website</dt>
            <dd className="mt-1">
              <Link
                className="font-semibold text-[#19d0a2] hover:underline"
                href={websiteHref}
              >
                {incident.monitor.website.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Monitor</dt>
            <dd className="mt-1">
              {incident.monitor.deletedAt ? (
                `${incident.monitor.name} (archived)`
              ) : (
                <Link
                  className="font-semibold text-[#19d0a2] hover:underline"
                  href={monitorHref}
                >
                  {incident.monitor.name}
                </Link>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold text-[var(--muted)]">URL</dt>
            <dd className="mt-1 break-all">{incident.monitor.normalizedUrl}</dd>
          </div>
          {adsContext ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-[var(--muted)]">
                Google Ads sources
              </dt>
              <dd className="mt-1">
                Enabled ad references {adsContext.enabledReferenceCount}
                {adsContext.campaignNames.length > 0 ? (
                  <>
                    . Campaigns {adsContext.campaignNames.join(", ")}
                    {adsContext.additionalCampaignCount > 0
                      ? ` +${adsContext.additionalCampaignCount}`
                      : ""}
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-[var(--muted)]">Started</dt>
            <dd className="mt-1">{formatStamp(incident.startedAt)} UTC</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Detected</dt>
            <dd className="mt-1">{formatStamp(incident.detectedAt)} UTC</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Resolved</dt>
            <dd className="mt-1">
              {incident.resolvedAt
                ? `${formatStamp(incident.resolvedAt)} UTC`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Duration</dt>
            <dd className="mt-1">
              {formatDuration(
                incidentDurationMs(incident.startedAt, incident.resolvedAt),
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Initial error</dt>
            <dd className="mt-1">
              {checkErrorLabel(incident.initialErrorType, null)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Latest error</dt>
            <dd className="mt-1">
              {checkErrorLabel(incident.latestErrorType, null)}
            </dd>
          </div>
          {incident.latestErrorType === "SOFT_404" ||
          incident.initialErrorType === "SOFT_404" ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-[var(--muted)]">Problem</dt>
              <dd className="mt-1">{checkErrorDetail("SOFT_404", null)}</dd>
            </div>
          ) : null}
          {incident.latestErrorType === "LEAD_RECEIPT_TIMEOUT" ||
          incident.initialErrorType === "LEAD_RECEIPT_TIMEOUT" ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-[var(--muted)]">Problem</dt>
              <dd className="mt-1">
                {checkErrorDetail("LEAD_RECEIPT_TIMEOUT", null)} Form submission
                was successful. Receipt verification timed out.
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-[var(--muted)]">Latest HTTP</dt>
            <dd className="mt-1">{incident.latestHttpStatus ?? "—"}</dd>
          </div>
          {incident.lastFailedCheck?.browserDetail?.screenshotKey ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-[var(--muted)]">Screenshot</dt>
              <dd className="mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Latest failure screenshot"
                  className="max-h-96 w-full rounded-xl border border-[var(--border)] object-contain"
                  src={`/app/${organizationSlug}/checks/${incident.lastFailedCheck.id}/screenshot`}
                />
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-[var(--muted)]">Failure count</dt>
            <dd className="mt-1">{incident.failureCount}</dd>
          </div>
        </dl>
      </section>

      {impactView ? (
        <GoogleAdsIncidentImpactCard
          organizationSlug={organizationSlug}
          incidentId={incident.id}
          view={impactView}
          canRefresh={canManageIntegrations}
        />
      ) : null}

      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Timeline</h2>
        {checks.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No checks in this incident window.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {checks.map((check) => (
              <li
                className="border-l-2 border-[var(--border)] pl-4"
                key={check.id}
              >
                <p className="text-sm text-[var(--muted)]">
                  {formatStamp(check.finishedAt)} UTC
                </p>
                <p className="mt-1 font-semibold">
                  {timelineLabel(
                    check.id,
                    check.status,
                    incident,
                    check.finishedAt,
                  )}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {check.status === "FAILURE"
                    ? checkErrorLabel(check.errorType, check.errorMessage)
                    : `${checkStatusLabel(check.status)}${
                        check.httpStatus != null
                          ? ` · HTTP ${check.httpStatus}`
                          : ""
                      }`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Notifications</h2>
        {deliveries.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No notification channels were configured when this incident was
            detected.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {deliveries.map((delivery) => (
              <li
                className="border-l-2 border-[var(--border)] pl-4"
                key={delivery.id}
              >
                <p className="text-sm text-[var(--muted)]">
                  {formatStamp(delivery.createdAt)} UTC
                </p>
                <p className="mt-1 font-semibold">
                  {delivery.eventType === "INCIDENT_OPENED"
                    ? "Incident opened"
                    : delivery.eventType === "INCIDENT_RESOLVED"
                      ? "Incident resolved"
                      : "Test"}{" "}
                  · {delivery.channelType === "EMAIL" ? "Email" : "Webhook"} ·{" "}
                  {delivery.channelName}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {delivery.status === "SENT"
                    ? `Sent${delivery.sentAt ? ` at ${formatStamp(delivery.sentAt)} UTC` : ""}`
                    : delivery.status === "FAILED"
                      ? "Failed"
                      : delivery.status === "SKIPPED"
                        ? "Skipped"
                        : delivery.status === "SENDING"
                          ? "Sending"
                          : "Pending"}
                </p>
                {delivery.status === "FAILED" ? (
                  <div className="mt-2 text-sm text-[var(--muted)]">
                    {delivery.lastAttemptAt ? (
                      <p>
                        Last attempt {formatStamp(delivery.lastAttemptAt)} UTC
                      </p>
                    ) : null}
                    {delivery.lastErrorMessage ? (
                      <p>Reason {delivery.lastErrorMessage}</p>
                    ) : null}
                    <p>Attempts {delivery.attemptCount}</p>
                    {canManageNotifications ? (
                      <NotificationDeliveryRetryForm
                        organizationSlug={organizationSlug}
                        incidentId={incident.id}
                        deliveryId={delivery.id}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
