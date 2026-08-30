import { describe, expect, it } from "vitest";
import { renderIncidentOpenedEmail } from "@/server/notifications/templates/email";
import type { IncidentNotificationPayloadV1 } from "@/server/notifications/payload";

const basePayload: IncidentNotificationPayloadV1 = {
  version: 1,
  eventType: "INCIDENT_OPENED",
  organizationId: "org",
  organizationSlug: "acme",
  incidentId: "inc",
  monitorId: "mon",
  websiteId: "site",
  websiteName: "Acme",
  websiteHostname: "example.com",
  websiteUrl: "https://example.com",
  monitorName: "Landing page",
  monitorUrl: "https://example.com/ad",
  startedAt: "2026-08-30T14:00:00.000Z",
  detectedAt: "2026-08-30T14:05:00.000Z",
  resolvedAt: null,
  errorType: "SOFT_404",
  errorMessage: null,
  httpStatus: 200,
  recoveryHttpStatus: null,
  durationMs: null,
};

describe("incident email copy", () => {
  it("describes a soft-404 without UNKNOWN", () => {
    const email = renderIncidentOpenedEmail(basePayload, null);
    expect(email.text).toContain(
      "Page returned HTTP 200 but appears to be a not-found page.",
    );
    expect(email.text).not.toContain("UNKNOWN");
    expect(email.html).not.toContain("UNKNOWN");
  });

  it("describes a missing required element by name", () => {
    const email = renderIncidentOpenedEmail(
      {
        ...basePayload,
        errorType: "REQUIRED_ELEMENT_MISSING",
        errorMessage: "Required element missing: Offerte aanvragen",
        httpStatus: 200,
      },
      null,
    );
    expect(email.text).toContain("Required element missing: Offerte aanvragen");
  });

  it("includes Google Ads impact without credentials", () => {
    const email = renderIncidentOpenedEmail(
      {
        ...basePayload,
        errorType: "HTTP_404",
        errorMessage: "HTTP 404",
        httpStatus: 404,
        googleAds: {
          enabledReferenceCount: 4,
          campaignNames: ["Airco Amsterdam", "Airco Randstad"],
          additionalCampaignCount: 0,
        },
      },
      null,
    );
    expect(email.subject).toContain("Active Google Ads destination is failing");
    expect(email.text).toContain("Impact calculation");
    expect(email.text).toContain("Pending");
    expect(email.text).not.toContain("refresh");
    expect(email.text).not.toContain("ya29");
  });

  it("describes a lead receipt timeout without calling the form down", () => {
    const email = renderIncidentOpenedEmail(
      {
        ...basePayload,
        errorType: "LEAD_RECEIPT_TIMEOUT",
        errorMessage:
          "The form accepted the test lead, but LeadGuard could not confirm that the lead was received downstream.",
        httpStatus: 200,
      },
      null,
    );
    expect(email.subject).toContain("Lead delivery could not be confirmed");
    expect(email.text).toContain(
      "could not confirm that the lead was received downstream",
    );
    expect(email.text).not.toContain("Form is down");
  });
});
