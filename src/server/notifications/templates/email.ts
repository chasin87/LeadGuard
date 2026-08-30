import { checkErrorLabel } from "@/lib/monitoring/display";
import { formatDuration } from "@/lib/incidents/duration";
import type { IncidentNotificationPayloadV1 } from "@/server/notifications/payload";
import { sanitizeHeaderValue } from "@/server/notifications/privacy";
import { emailLayout } from "@/server/notifications/templates/layout";
import { formatCurrencyFromMicros } from "@/lib/google-ads/money";
import type { MonitorCheckErrorType } from "@/generated/prisma/enums";

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function errorTypeOf(
  payload: IncidentNotificationPayloadV1,
): MonitorCheckErrorType | null {
  return (payload.errorType as MonitorCheckErrorType | null) ?? null;
}

function adsImpact(payload: IncidentNotificationPayloadV1): string | null {
  const ads = payload.googleAds;
  if (!ads || ads.enabledReferenceCount < 1) return null;
  const campaigns = ads.campaignNames.join(", ");
  const extra =
    ads.additionalCampaignCount > 0
      ? ` +${ads.additionalCampaignCount} more`
      : "";
  return `${ads.enabledReferenceCount} enabled ad references across ${ads.campaignNames.length + ads.additionalCampaignCount} campaigns${campaigns ? ` (${campaigns}${extra})` : ""}`;
}

function problemLabel(payload: IncidentNotificationPayloadV1): string {
  const errorType = (payload.errorType as MonitorCheckErrorType | null) ?? null;
  if (errorType === "SOFT_404") {
    return "Page returned HTTP 200 but appears to be a not-found page.";
  }
  if (errorType === "REQUIRED_ELEMENT_MISSING") {
    return (
      payload.errorMessage ?? "Expected page element is no longer visible."
    );
  }
  if (errorType === "FORM_SUBMISSION_FAILED") {
    return (
      payload.errorMessage ??
      "LeadGuard could open and fill the form, but the submission did not complete successfully."
    );
  }
  if (errorType === "FORM_SUCCESS_NOT_CONFIRMED") {
    return "Lead form no longer confirms successful submissions.";
  }
  if (errorType === "LEAD_RECEIPT_TIMEOUT") {
    return (
      payload.errorMessage ??
      "The test form was submitted successfully, but LeadGuard did not receive confirmation that the lead arrived downstream."
    );
  }
  return checkErrorLabel(
    errorType,
    payload.errorMessage ??
      (payload.httpStatus != null ? `HTTP ${payload.httpStatus}` : null),
  );
}

export function renderIncidentOpenedEmail(
  payload: IncidentNotificationPayloadV1,
  incidentUrl: string | null,
) {
  const monitorName = sanitizeHeaderValue(payload.monitorName || "Monitor");
  const receiptTimeout = errorTypeOf(payload) === "LEAD_RECEIPT_TIMEOUT";
  const ads = adsImpact(payload);
  const adsIncident = Boolean(
    payload.googleAds && payload.googleAds.enabledReferenceCount > 0,
  );
  const content = emailLayout({
    preheader: receiptTimeout
      ? "Lead delivery could not be confirmed."
      : adsIncident
        ? "Active Google Ads destination is failing."
        : `${payload.websiteName} is down.`,
    title: receiptTimeout
      ? "Lead delivery could not be confirmed"
      : adsIncident
        ? "Active Google Ads destination is failing"
        : "LeadGuard detected a problem.",
    rows: [
      { label: "Website", value: payload.websiteName },
      { label: "Monitor", value: payload.monitorName },
      { label: "Destination", value: payload.monitorUrl },
      { label: "Problem", value: problemLabel(payload) },
      ...(ads ? [{ label: "Google Ads", value: ads }] : []),
      ...(payload.googleAds
        ? [
            {
              label: "Impact calculation",
              value:
                payload.googleAds.impactStatus &&
                payload.googleAds.impactStatus !== "PENDING"
                  ? payload.googleAds.impactStatus
                  : "Pending",
            },
          ]
        : []),
      { label: "Started", value: `${formatStamp(payload.startedAt)} UTC` },
      { label: "Detected", value: `${formatStamp(payload.detectedAt)} UTC` },
      {
        label: "Current status",
        value: receiptTimeout ? "Not confirmed" : "Down",
      },
      ...(incidentUrl ? [{ label: "Incident", value: incidentUrl }] : []),
    ],
  });
  return {
    subject: receiptTimeout
      ? `[LeadGuard] Incident: Lead delivery could not be confirmed`
      : adsIncident
        ? `[LeadGuard] Incident: Active Google Ads destination is failing`
        : `[LeadGuard] Incident: ${monitorName} is down`,
    ...content,
  };
}

export function renderIncidentResolvedEmail(
  payload: IncidentNotificationPayloadV1,
  incidentUrl: string | null,
) {
  const monitorName = sanitizeHeaderValue(payload.monitorName || "Monitor");
  const recovered = payload.resolvedAt
    ? `${formatStamp(payload.resolvedAt)} UTC`
    : "—";
  const duration =
    payload.durationMs != null ? formatDuration(payload.durationMs) : "—";
  const latest =
    payload.recoveryHttpStatus != null
      ? `HTTP ${payload.recoveryHttpStatus}`
      : "Recovery confirmed";
  const receiptRecovery = errorTypeOf(payload) === "LEAD_RECEIPT_TIMEOUT";
  const impactSpend =
    payload.googleAds?.impactCostMicros && payload.googleAds.impactCurrency
      ? formatCurrencyFromMicros(
          BigInt(payload.googleAds.impactCostMicros),
          payload.googleAds.impactCurrency,
        )
      : null;
  const content = emailLayout({
    preheader: receiptRecovery
      ? "Lead delivery confirmed again."
      : `${payload.websiteName} is back online.`,
    title: receiptRecovery
      ? "Lead delivery confirmed again"
      : "LeadGuard confirmed recovery.",
    rows: [
      { label: "Website", value: payload.websiteName },
      { label: "Monitor", value: payload.monitorName },
      { label: "Recovered", value: recovered },
      { label: "Total incident duration", value: duration },
      { label: "Latest result", value: latest },
      ...(impactSpend
        ? [{ label: "Estimated spend at risk", value: impactSpend }]
        : []),
      ...(incidentUrl ? [{ label: "Incident", value: incidentUrl }] : []),
    ],
  });
  return {
    subject: receiptRecovery
      ? `[LeadGuard] Resolved: Lead delivery confirmed again`
      : `[LeadGuard] Resolved: ${monitorName} is back online`,
    ...content,
  };
}

export function renderTestEmail(channelName: string) {
  const content = emailLayout({
    preheader: "This is a LeadGuard test notification.",
    title: "This is a LeadGuard test notification.",
    rows: [{ label: "Channel", value: channelName }],
    footer: "No incident was opened. You can ignore this message.",
  });
  return {
    subject: "[LeadGuard] Test notification",
    ...content,
  };
}
