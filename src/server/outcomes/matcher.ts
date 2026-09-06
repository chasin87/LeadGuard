import type {
  ExternalLeadMatchMethod,
  LeadOutcomeStatus,
} from "@/generated/prisma/enums";

export type MatchCandidate = {
  id: string;
  organizationId: string;
  websiteId: string;
  publicLeadId: string;
  externalLeadId: string | null;
};

export type ExistingLeadLink = {
  leadId: string;
  sourceRecordId: string;
};

export type ExternalOutcomeMatchInput = {
  organizationId: string;
  allowedWebsiteIds: readonly string[];
  sourceRecordId: string | null;
  externalLeadId: string | null;
  publicLeadId: string | null;
  existingLink: ExistingLeadLink | null;
  leadsByExternalId: readonly MatchCandidate[];
  leadByPublicId: MatchCandidate | null;
};

export type ExternalOutcomeMatchResult =
  | {
      status: "MATCHED";
      leadId: string;
      method: ExternalLeadMatchMethod;
    }
  | { status: "UNMATCHED" }
  | { status: "AMBIGUOUS" }
  | { status: "CONFLICT"; code: "SOURCE_RECORD_ALREADY_LINKED" };

function inScope(
  lead: MatchCandidate,
  organizationId: string,
  allowedWebsiteIds: readonly string[],
): boolean {
  return (
    lead.organizationId === organizationId &&
    allowedWebsiteIds.includes(lead.websiteId)
  );
}

function identifiedLeadId(
  input: ExternalOutcomeMatchInput,
): { leadId: string; method: ExternalLeadMatchMethod } | "AMBIGUOUS" | null {
  const scopedExternal = input.leadsByExternalId.filter((lead) =>
    inScope(lead, input.organizationId, input.allowedWebsiteIds),
  );
  if (input.externalLeadId) {
    if (scopedExternal.length > 1) return "AMBIGUOUS";
    if (scopedExternal.length === 1) {
      return {
        leadId: scopedExternal[0]!.id,
        method: "EXTERNAL_LEAD_ID",
      };
    }
  }
  if (input.publicLeadId && input.leadByPublicId) {
    if (
      inScope(
        input.leadByPublicId,
        input.organizationId,
        input.allowedWebsiteIds,
      )
    ) {
      return { leadId: input.leadByPublicId.id, method: "PUBLIC_LEAD_ID" };
    }
  }
  return null;
}

export function matchExternalOutcomeToLead(
  input: ExternalOutcomeMatchInput,
): ExternalOutcomeMatchResult {
  const identified = identifiedLeadId(input);

  if (input.existingLink) {
    if (identified === "AMBIGUOUS") {
      return { status: "AMBIGUOUS" };
    }
    if (identified && identified.leadId !== input.existingLink.leadId) {
      return { status: "CONFLICT", code: "SOURCE_RECORD_ALREADY_LINKED" };
    }
    return {
      status: "MATCHED",
      leadId: input.existingLink.leadId,
      method: identified?.method ?? "SOURCE_RECORD_LINK",
    };
  }

  if (identified === "AMBIGUOUS") return { status: "AMBIGUOUS" };
  if (identified) {
    return {
      status: "MATCHED",
      leadId: identified.leadId,
      method: identified.method,
    };
  }
  return { status: "UNMATCHED" };
}

export function sameLeadState(
  left: {
    status: LeadOutcomeStatus;
    revenueAmountMinor: bigint | null;
    revenueCurrencyCode: string | null;
  },
  right: {
    status: LeadOutcomeStatus;
    revenueAmountMinor: bigint | null;
    revenueCurrencyCode: string | null;
  },
): boolean {
  return (
    left.status === right.status &&
    left.revenueAmountMinor === right.revenueAmountMinor &&
    left.revenueCurrencyCode === right.revenueCurrencyCode
  );
}
