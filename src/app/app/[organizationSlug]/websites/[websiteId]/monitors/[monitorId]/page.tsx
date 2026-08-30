import Link from "next/link";
import { notFound } from "next/navigation";
import { MonitorHealthBadge } from "@/components/monitor-health-badge";
import {
  MonitorPauseForm,
  MonitorRunCheckForm,
} from "@/components/monitor-run-check-form";
import { FormMonitorControls } from "@/components/form-monitor-controls";
import { ReceiptStatusPoller } from "@/components/receipt-status-poller";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import {
  MonitorNotFoundError,
  WebsiteNotFoundError,
} from "@/server/security/errors";
import { getMonitor, listMonitorChecks } from "@/server/monitors/service";
import { getWebsite } from "@/server/websites/service";
import { deriveMonitorHealth } from "@/server/incidents/health";
import {
  checkErrorDetail,
  checkErrorLabel,
  checkIncidentHeadline,
  checkStatusLabel,
  formatInterval,
  formatRelativeTime,
  formatTimeout,
  healthLabel,
  javascriptErrorSummaries,
  monitorTypeLabel,
  viewportLabel,
} from "@/lib/monitoring/display";
import {
  formatSoft404Signal,
  parseStoredSoft404Signals,
  soft404ConfidenceLabel,
} from "@/server/monitoring/soft404/signals";
import { formatDuration, incidentDurationMs } from "@/lib/incidents/duration";
import { getGoogleAdsContextForMonitor } from "@/server/google-ads/context";
import { googleAdsStatusLabel } from "@/server/google-ads/active";

export const metadata = { title: "Monitor" };

export default async function MonitorDetailPage({
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
  let website;
  try {
    website = await getWebsite(user.id, organizationSlug, websiteId);
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

  const checks = await listMonitorChecks(
    user.id,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const adsContext =
    monitor.type === "AD_DESTINATION"
      ? await getGoogleAdsContextForMonitor(monitor.id)
      : null;
  const health = deriveMonitorHealth({
    latestCheck: monitor.latestCheck,
    hasOpenIncident: Boolean(monitor.openIncident),
    receiptStatus: monitor.latestCheck?.leadReceiptVerification?.status,
  });
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "monitors:manage",
  );
  const base = `/app/${organizationSlug}/websites/${websiteId}`;

  return (
    <div className="px-5 py-10 lg:px-10">
      <ReceiptStatusPoller
        active={
          monitor.latestCheck?.leadReceiptVerification?.status === "PENDING"
        }
      />
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={base}
        >
          {website.name}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{monitor.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {monitorTypeLabel(monitor.type)} monitor
          </p>
          <div className="mt-3">
            <MonitorHealthBadge health={health} />
          </div>
          {monitor.openIncident ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Open incident · started{" "}
              {formatDuration(
                incidentDurationMs(monitor.openIncident.startedAt, null),
              )}{" "}
              ago
              {monitor.latestCheck?.status === "FAILURE"
                ? ` · ${checkErrorLabel(monitor.latestCheck.errorType, monitor.latestCheck.errorMessage)}`
                : ""}
            </p>
          ) : health === "failing" ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {monitor.consecutiveFailures} consecutive{" "}
              {monitor.consecutiveFailures === 1 ? "failure" : "failures"} ·
              incident after {monitor.consecutiveFailuresBeforeIncident}{" "}
              {monitor.consecutiveFailuresBeforeIncident === 1
                ? "failure"
                : "failures"}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-3">
            {monitor.type === "FORM" ? (
              <>
                <FormMonitorControls
                  organizationSlug={organizationSlug}
                  websiteId={websiteId}
                  monitorId={monitor.id}
                  websiteActive={website.status === "ACTIVE"}
                  monitorStatus={monitor.status}
                  configurationStatus={
                    monitor.formConfig?.configurationStatus ?? "UNVERIFIED"
                  }
                  verified={
                    monitor.formConfig?.configurationStatus === "VERIFIED" &&
                    (monitor.formConfig.receiptMode === "NONE" ||
                      Boolean(monitor.formConfig.receiptVerifiedAt))
                  }
                />
                {monitor.status === "ACTIVE" ? (
                  <MonitorPauseForm
                    organizationSlug={organizationSlug}
                    websiteId={websiteId}
                    monitorId={monitor.id}
                    status={monitor.status}
                  />
                ) : null}
              </>
            ) : (
              <>
                <MonitorRunCheckForm
                  organizationSlug={organizationSlug}
                  websiteId={websiteId}
                  monitorId={monitor.id}
                  websiteActive={website.status === "ACTIVE"}
                  monitorStatus={monitor.status}
                />
                <MonitorPauseForm
                  organizationSlug={organizationSlug}
                  websiteId={websiteId}
                  monitorId={monitor.id}
                  status={monitor.status}
                />
              </>
            )}
            <Link
              className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              href={`${base}/monitors/${monitor.id}/settings`}
            >
              Monitor settings
            </Link>
          </div>
        ) : null}
      </div>

      {monitor.latestCheck?.errorType === "INVALID_MONITOR_CONFIGURATION" ? (
        <p className="mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Monitor configuration requires attention. This is not a website
          outage. Fix the configuration and run a new check.
        </p>
      ) : null}

      {monitor.latestCheck?.errorType === "UNSUPPORTED_CAPTCHA" ||
      monitor.latestCheck?.errorType === "UNSUPPORTED_FORM_TYPE" ? (
        <p className="mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {checkErrorDetail(
            monitor.latestCheck.errorType,
            monitor.latestCheck.errorMessage,
          )}
        </p>
      ) : null}

      {monitor.latestCheck?.leadReceiptVerification?.status === "PENDING" ? (
        <p className="mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Submission confirmed. Waiting for receipt...
        </p>
      ) : null}

      {monitor.type === "FORM" &&
      monitor.formConfig?.receiptMode !== "NONE" &&
      monitor.formConfig?.configurationStatus === "VERIFIED" &&
      !monitor.formConfig.receiptVerifiedAt ? (
        <p className="mt-6 max-w-2xl rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          Scheduled tests stay paused until a real test confirms downstream
          receipt.
        </p>
      ) : null}

      {monitor.openIncident &&
      (monitor.status === "PAUSED" || website.status !== "ACTIVE") ? (
        <p className="mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Monitoring paused while incident is open. Recovery cannot be confirmed
          until monitoring resumes.
        </p>
      ) : null}

      {monitor.openIncident ? (
        <p className="mt-4 text-sm">
          <Link
            className="font-semibold text-[#19d0a2] hover:underline"
            href={`/app/${organizationSlug}/incidents/${monitor.openIncident.id}`}
          >
            View open incident
          </Link>
        </p>
      ) : null}

      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--muted)]">Type</dt>
            <dd className="mt-1">{monitorTypeLabel(monitor.type)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">URL</dt>
            <dd className="mt-1 break-all">{monitor.normalizedUrl}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Status</dt>
            <dd className="mt-1">
              {monitor.status === "ACTIVE" ? "Active" : "Paused"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Health</dt>
            <dd className="mt-1">{healthLabel(health)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Incident threshold
            </dt>
            <dd className="mt-1">
              {monitor.consecutiveFailuresBeforeIncident} consecutive{" "}
              {monitor.consecutiveFailuresBeforeIncident === 1
                ? "failure"
                : "failures"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Frequency</dt>
            <dd className="mt-1">{formatInterval(monitor.intervalSeconds)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Timeout</dt>
            <dd className="mt-1">{formatTimeout(monitor.timeoutMs)}</dd>
          </div>
          {monitor.formConfig ? (
            <>
              <div>
                <dt className="font-semibold text-[var(--muted)]">Viewport</dt>
                <dd className="mt-1">
                  {viewportLabel(monitor.formConfig.viewport)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--muted)]">
                  Configuration
                </dt>
                <dd className="mt-1">
                  {monitor.formConfig.configurationStatus}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--muted)]">Form</dt>
                <dd className="mt-1 font-mono text-xs">
                  {monitor.formConfig.formSelector}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--muted)]">Submit</dt>
                <dd className="mt-1 font-mono text-xs">
                  {monitor.formConfig.submitSelector}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--muted)]">
                  Lead receipt
                </dt>
                <dd className="mt-1">
                  {monitor.formConfig.receiptMode === "NONE"
                    ? "Disabled"
                    : monitor.formConfig.receiptMode === "INBOUND_EMAIL"
                      ? "Inbound email"
                      : "Webhook"}
                </dd>
              </div>
            </>
          ) : null}
          {monitor.browserConfig ? (
            <>
              <div>
                <dt className="font-semibold text-[var(--muted)]">Viewport</dt>
                <dd className="mt-1">
                  {viewportLabel(monitor.browserConfig.viewport)}
                </dd>
              </div>
              {monitor.browserConfig.requiredSelector ? (
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    Required element
                  </dt>
                  <dd className="mt-1">
                    {monitor.browserConfig.requiredElementName
                      ? `${monitor.browserConfig.requiredElementName} (${monitor.browserConfig.requiredSelector})`
                      : monitor.browserConfig.requiredSelector}
                  </dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
      </section>

      {adsContext ? (
        <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-lg font-bold">Google Ads sources</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {adsContext.enabledReferenceCount} enabled ad references
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            {adsContext.references.map((reference) => (
              <li key={reference.id}>
                {reference.campaignName}
                {reference.adGroupName ? ` · ${reference.adGroupName}` : ""}
                {reference.assetGroupName
                  ? ` · ${reference.assetGroupName}`
                  : ""}{" "}
                · {googleAdsStatusLabel(reference.campaignStatus)}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <Link
              className="font-semibold text-[#19d0a2] hover:underline"
              href={`/app/${organizationSlug}/integrations/google-ads/destinations/${adsContext.targetId}`}
            >
              View destination
            </Link>
          </p>
        </section>
      ) : null}

      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Current result</h2>
        {monitor.latestCheck ? (
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                Last checked
              </dt>
              <dd className="mt-1">
                {formatRelativeTime(monitor.latestCheck.finishedAt)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">HTTP status</dt>
              <dd className="mt-1">{monitor.latestCheck.httpStatus ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                Response time
              </dt>
              <dd className="mt-1">
                {monitor.latestCheck.responseTimeMs != null
                  ? `${monitor.latestCheck.responseTimeMs} ms`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Final URL</dt>
              <dd className="mt-1 break-all">
                {monitor.latestCheck.finalUrl ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Redirects</dt>
              <dd className="mt-1">{monitor.latestCheck.redirectCount}</dd>
            </div>
            {monitor.latestCheck.errorType ? (
              <div>
                <dt className="font-semibold text-[var(--muted)]">Reason</dt>
                <dd className="mt-1">
                  {checkIncidentHeadline(
                    monitor.latestCheck.errorType,
                    monitor.latestCheck.errorMessage,
                  )}
                </dd>
              </div>
            ) : null}
            {monitor.type === "FORM" && monitor.latestCheck.errorType ? (
              <div className="sm:col-span-2">
                <dt className="font-semibold text-[var(--muted)]">Detail</dt>
                <dd className="mt-1">
                  {checkErrorDetail(
                    monitor.latestCheck.errorType,
                    monitor.latestCheck.errorMessage,
                  )}
                </dd>
              </div>
            ) : null}
            {monitor.latestCheck.errorType === "SOFT_404" ? (
              <>
                <div className="sm:col-span-2">
                  <dt className="font-semibold text-[var(--muted)]">Detail</dt>
                  <dd className="mt-1">
                    {checkErrorDetail(
                      monitor.latestCheck.errorType,
                      monitor.latestCheck.errorMessage,
                    )}
                  </dd>
                </div>
                {monitor.latestCheck.soft404Score != null ? (
                  <div>
                    <dt className="font-semibold text-[var(--muted)]">
                      Confidence
                    </dt>
                    <dd className="mt-1">
                      {soft404ConfidenceLabel(monitor.latestCheck.soft404Score)}{" "}
                      ({monitor.latestCheck.soft404Score}%)
                    </dd>
                  </div>
                ) : null}
                {parseStoredSoft404Signals(monitor.latestCheck.soft404Signals)
                  .length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[var(--muted)]">
                      Signals
                    </dt>
                    <dd className="mt-1">
                      <ul className="list-disc space-y-1 pl-5">
                        {parseStoredSoft404Signals(
                          monitor.latestCheck.soft404Signals,
                        ).map((code) => (
                          <li key={code}>{formatSoft404Signal(code)}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
            {monitor.latestCheck.browserDetail ? (
              <>
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    Viewport
                  </dt>
                  <dd className="mt-1">
                    {viewportLabel(monitor.latestCheck.browserDetail.viewport)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    Navigation
                  </dt>
                  <dd className="mt-1">
                    {monitor.latestCheck.browserDetail.navigationDurationMs !=
                    null
                      ? `${(monitor.latestCheck.browserDetail.navigationDurationMs / 1000).toFixed(1)} sec`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    Total check
                  </dt>
                  <dd className="mt-1">
                    {monitor.latestCheck.browserDetail.totalDurationMs != null
                      ? `${(monitor.latestCheck.browserDetail.totalDurationMs / 1000).toFixed(1)} sec`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    JavaScript errors
                  </dt>
                  <dd className="mt-1">
                    {monitor.latestCheck.browserDetail.javascriptErrorCount}
                  </dd>
                </div>
                {javascriptErrorSummaries(
                  monitor.latestCheck.browserDetail.javascriptErrors,
                ).length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[var(--muted)]">
                      Runtime errors
                    </dt>
                    <dd className="mt-1">
                      <ul className="list-disc space-y-1 pl-5">
                        {javascriptErrorSummaries(
                          monitor.latestCheck.browserDetail.javascriptErrors,
                        ).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
                {monitor.latestCheck.browserDetail.screenshotKey ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[var(--muted)]">
                      Screenshot
                    </dt>
                    <dd className="mt-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Failure screenshot"
                        className="max-h-96 w-full rounded-xl border border-[var(--border)] object-contain"
                        src={`/app/${organizationSlug}/checks/${monitor.latestCheck.id}/screenshot`}
                      />
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
            {monitor.latestCheck.formDetail ? (
              <>
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    Submission
                  </dt>
                  <dd className="mt-1">
                    {monitor.latestCheck.formDetail.successConfirmed
                      ? "Successful"
                      : monitor.latestCheck.formDetail.submitClicked
                        ? "Clicked"
                        : "Not submitted"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--muted)]">Fields</dt>
                  <dd className="mt-1">
                    {monitor.latestCheck.formDetail.fieldsFoundCount}/
                    {monitor.latestCheck.formDetail.fieldsExpectedCount} found
                  </dd>
                </div>
                {monitor.latestCheck.formDetail.submissionDurationMs != null ? (
                  <div>
                    <dt className="font-semibold text-[var(--muted)]">
                      Duration
                    </dt>
                    <dd className="mt-1">
                      {(
                        monitor.latestCheck.formDetail.submissionDurationMs /
                        1000
                      ).toFixed(1)}{" "}
                      sec
                    </dd>
                  </div>
                ) : null}
                {monitor.latestCheck.formDetail.submitEndpointPath ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[var(--muted)]">
                      Request
                    </dt>
                    <dd className="mt-1">
                      {monitor.latestCheck.formDetail.submitMethod}{" "}
                      {monitor.latestCheck.formDetail.submitEndpointPath}
                      {monitor.latestCheck.formDetail.submitHttpStatus != null
                        ? ` → ${monitor.latestCheck.formDetail.submitHttpStatus}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-semibold text-[var(--muted)]">
                    Success confirmation
                  </dt>
                  <dd className="mt-1">
                    {monitor.latestCheck.formDetail.successConfirmed
                      ? "Detected"
                      : "Not detected"}
                  </dd>
                </div>
                {monitor.latestCheck.formDetail.screenshotKey ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[var(--muted)]">
                      Screenshot
                    </dt>
                    <dd className="mt-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Failure screenshot"
                        className="max-h-96 w-full rounded-xl border border-[var(--border)] object-contain"
                        src={`/app/${organizationSlug}/checks/${monitor.latestCheck.id}/screenshot`}
                      />
                    </dd>
                  </div>
                ) : null}
                {monitor.latestCheck.leadReceiptVerification ? (
                  <>
                    <div>
                      <dt className="font-semibold text-[var(--muted)]">
                        Lead receipt
                      </dt>
                      <dd className="mt-1">
                        {monitor.latestCheck.leadReceiptVerification.status ===
                        "RECEIVED"
                          ? "Confirmed"
                          : monitor.latestCheck.leadReceiptVerification
                                .status === "PENDING"
                            ? "Waiting for receipt..."
                            : "Not confirmed"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-[var(--muted)]">
                        Method
                      </dt>
                      <dd className="mt-1">
                        {monitor.latestCheck.leadReceiptVerification
                          .sourceType === "INBOUND_EMAIL" ||
                        monitor.latestCheck.leadReceiptVerification.method ===
                          "INBOUND_EMAIL"
                          ? "Inbound email"
                          : "Webhook"}
                      </dd>
                    </div>
                    {monitor.latestCheck.leadReceiptVerification
                      .receiptLatencyMs != null ? (
                      <div>
                        <dt className="font-semibold text-[var(--muted)]">
                          Receipt latency
                        </dt>
                        <dd className="mt-1">
                          {(
                            monitor.latestCheck.leadReceiptVerification
                              .receiptLatencyMs / 1000
                          ).toFixed(1)}{" "}
                          sec
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="font-semibold text-[var(--muted)]">
                        Submission ID
                      </dt>
                      <dd className="mt-1 font-mono text-xs">
                        {monitor.latestCheck.leadReceiptVerification
                          .submissionId ??
                          monitor.latestCheck.formDetail.submissionId}
                      </dd>
                    </div>
                    {monitor.latestCheck.leadReceiptVerification.lateReceipt ? (
                      <div className="sm:col-span-2">
                        <dt className="font-semibold text-[var(--muted)]">
                          Late receipt
                        </dt>
                        <dd className="mt-1">
                          Receipt arrived late
                          {monitor.latestCheck.leadReceiptVerification
                            .receivedAt
                            ? ` · received ${formatDuration(
                                Math.max(
                                  0,
                                  monitor.latestCheck.leadReceiptVerification.receivedAt.getTime() -
                                    monitor.latestCheck.leadReceiptVerification.timeoutAt.getTime(),
                                ),
                              )} after timeout`
                            : ""}
                          . The timeout result is kept; the next successful test
                          can recover the incident.
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </dl>
        ) : (
          <p className="mt-2 text-[var(--muted)]">Pending first check</p>
        )}
      </section>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Recent checks</h2>
        {checks.length === 0 ? (
          <p className="mt-2 text-[var(--muted)]">No checks recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-slate-50">
                <tr>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">HTTP</th>
                  <th className="px-3 py-2 font-semibold">Response time</th>
                  <th className="px-3 py-2 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr
                    className="border-b border-[var(--border)] last:border-0"
                    key={check.id}
                  >
                    <td className="px-3 py-2">
                      {formatRelativeTime(check.finishedAt)}
                    </td>
                    <td className="px-3 py-2">
                      {checkStatusLabel(check.status)}
                    </td>
                    <td className="px-3 py-2">{check.httpStatus ?? "—"}</td>
                    <td className="px-3 py-2">
                      {check.responseTimeMs != null
                        ? `${check.responseTimeMs} ms`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {check.errorType === "LEAD_RECEIPT_TIMEOUT"
                        ? "Receipt timeout"
                        : check.status === "SUCCESS" &&
                            check.leadReceiptVerification?.status === "RECEIVED"
                          ? "Lead received"
                          : check.status === "SUCCESS" &&
                              check.leadReceiptVerification?.status ===
                                "PENDING"
                            ? "Waiting for receipt"
                            : check.status === "SUCCESS" &&
                                monitor.type === "BROWSER"
                              ? "Rendered correctly"
                              : check.status === "SUCCESS" &&
                                  monitor.type === "FORM"
                                ? "Submission confirmed"
                                : checkErrorLabel(
                                    check.errorType,
                                    check.errorMessage,
                                  )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
