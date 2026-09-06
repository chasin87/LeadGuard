import { describe, expect, it } from "vitest";
import { matchExternalOutcomeToLead } from "./matcher";

const leadA = {
  id: "lead-a",
  organizationId: "org-1",
  websiteId: "site-1",
  publicLeadId: "lgl_aaa",
  externalLeadId: "quote_123",
};

const leadB = {
  id: "lead-b",
  organizationId: "org-1",
  websiteId: "site-2",
  publicLeadId: "lgl_bbb",
  externalLeadId: "quote_123",
};

describe("matchExternalOutcomeToLead", () => {
  it("matches an exact externalLeadId within allowed websites", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1"],
      sourceRecordId: null,
      externalLeadId: "quote_123",
      publicLeadId: null,
      existingLink: null,
      leadsByExternalId: [leadA],
      leadByPublicId: null,
    });
    expect(result).toEqual({
      status: "MATCHED",
      leadId: "lead-a",
      method: "EXTERNAL_LEAD_ID",
    });
  });

  it("does not match a similar external id", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1"],
      sourceRecordId: null,
      externalLeadId: "quote_1234",
      publicLeadId: null,
      existingLink: null,
      leadsByExternalId: [],
      leadByPublicId: null,
    });
    expect(result).toEqual({ status: "UNMATCHED" });
  });

  it("does not cross-match the same external id on another website", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1"],
      sourceRecordId: null,
      externalLeadId: "quote_123",
      publicLeadId: null,
      existingLink: null,
      leadsByExternalId: [leadB],
      leadByPublicId: null,
    });
    expect(result).toEqual({ status: "UNMATCHED" });
  });

  it("returns AMBIGUOUS when two allowed websites share the id", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1", "site-2"],
      sourceRecordId: null,
      externalLeadId: "quote_123",
      publicLeadId: null,
      existingLink: null,
      leadsByExternalId: [leadA, leadB],
      leadByPublicId: null,
    });
    expect(result).toEqual({ status: "AMBIGUOUS" });
  });

  it("matches publicLeadId inside the tenant and website scope", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1"],
      sourceRecordId: null,
      externalLeadId: null,
      publicLeadId: "lgl_aaa",
      existingLink: null,
      leadsByExternalId: [],
      leadByPublicId: leadA,
    });
    expect(result).toEqual({
      status: "MATCHED",
      leadId: "lead-a",
      method: "PUBLIC_LEAD_ID",
    });
  });

  it("reuses an existing source record link", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1"],
      sourceRecordId: "deal-1",
      externalLeadId: null,
      publicLeadId: null,
      existingLink: { leadId: "lead-a", sourceRecordId: "deal-1" },
      leadsByExternalId: [],
      leadByPublicId: null,
    });
    expect(result).toEqual({
      status: "MATCHED",
      leadId: "lead-a",
      method: "SOURCE_RECORD_LINK",
    });
  });

  it("conflicts when a linked source record points at another lead", () => {
    const result = matchExternalOutcomeToLead({
      organizationId: "org-1",
      allowedWebsiteIds: ["site-1", "site-2"],
      sourceRecordId: "deal-1",
      externalLeadId: null,
      publicLeadId: "lgl_bbb",
      existingLink: { leadId: "lead-a", sourceRecordId: "deal-1" },
      leadsByExternalId: [],
      leadByPublicId: leadB,
    });
    expect(result).toEqual({
      status: "CONFLICT",
      code: "SOURCE_RECORD_ALREADY_LINKED",
    });
  });
});
