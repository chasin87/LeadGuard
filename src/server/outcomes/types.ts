import type { LeadOutcomeStatus } from "@/generated/prisma/enums";

export type NormalizedExternalOutcomeEvent = {
  integrationId: string;
  sourceSystem: string;
  sourceRecordId: string | null;
  sourceEventId: string;
  sourceVersion: number | null;
  externalLeadId: string | null;
  publicLeadId: string | null;
  status: LeadOutcomeStatus;
  effectiveAt: Date;
  revenueAmount: string | null;
  revenueCurrency: string | null;
};

export type ExternalOutcomeAdapter<TPayload> = {
  sourceSystem: string;
  normalize(payload: TPayload): NormalizedExternalOutcomeEvent;
};
