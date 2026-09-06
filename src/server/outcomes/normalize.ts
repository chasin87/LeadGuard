import { LEAD_OUTCOME_STATUSES } from "@/server/leads/outcome";
import type { LeadOutcomeStatus } from "@/generated/prisma/enums";
import type { NormalizedExternalOutcomeEvent } from "@/server/outcomes/types";

const SOURCE_EVENT_ID = /^[\x21-\x7E]{1,128}$/;
const OPTIONAL_ID = /^[\x21-\x7E]{1,191}$/;
const SOURCE_SYSTEM = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type OutcomeIngestionErrorCode =
  | "INVALID_STATUS"
  | "INVALID_REVENUE"
  | "INVALID_CURRENCY"
  | "INVALID_EFFECTIVE_AT"
  | "MISSING_EVENT_ID"
  | "LEAD_NOT_FOUND"
  | "AMBIGUOUS_MATCH"
  | "SOURCE_RECORD_ALREADY_LINKED"
  | "STALE_EVENT"
  | "OUTCOME_VERSION_CONFLICT"
  | "INTEGRATION_DISABLED"
  | "INVALID_PAYLOAD";

export type ParsedOutcomeEventInput = {
  eventId: string;
  externalLeadId: string | null;
  publicLeadId: string | null;
  sourceRecordId: string | null;
  sourceVersion: number | null;
  status: LeadOutcomeStatus;
  effectiveAt: Date;
  revenueAmount: string | null;
  revenueCurrency: string | null;
};

export type ParseOutcomeEventResult =
  | { ok: true; value: ParsedOutcomeEventInput }
  | { ok: false; code: OutcomeIngestionErrorCode; message: string };

function readString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function isAllowedSourceSystem(value: string): boolean {
  return SOURCE_SYSTEM.test(value);
}

export function parseOutcomeEventPayload(
  payload: unknown,
): ParseOutcomeEventResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "INVALID_PAYLOAD", message: "Invalid payload." };
  }
  const body = payload as Record<string, unknown>;
  const eventId = readString(body.eventId);
  if (!eventId) {
    return {
      ok: false,
      code: "MISSING_EVENT_ID",
      message: "eventId is required.",
    };
  }
  if (!SOURCE_EVENT_ID.test(eventId)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      message: "eventId is invalid.",
    };
  }

  const statusRaw = readString(body.status);
  const status = LEAD_OUTCOME_STATUSES.find((item) => item === statusRaw);
  if (!status) {
    return {
      ok: false,
      code: "INVALID_STATUS",
      message: "status must be NEW, QUALIFIED, WON or LOST.",
    };
  }

  const effectiveRaw = readString(body.effectiveAt);
  if (!effectiveRaw) {
    return {
      ok: false,
      code: "INVALID_EFFECTIVE_AT",
      message: "effectiveAt is required.",
    };
  }
  const effectiveAt = new Date(effectiveRaw);
  if (Number.isNaN(effectiveAt.getTime())) {
    return {
      ok: false,
      code: "INVALID_EFFECTIVE_AT",
      message: "effectiveAt must be an ISO-8601 timestamp.",
    };
  }

  const externalLeadId = readString(body.externalLeadId);
  const publicLeadId = readString(body.publicLeadId);
  const sourceRecordId = readString(body.sourceRecordId);
  if (externalLeadId && !OPTIONAL_ID.test(externalLeadId)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      message: "externalLeadId is invalid.",
    };
  }
  if (publicLeadId && !OPTIONAL_ID.test(publicLeadId)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      message: "publicLeadId is invalid.",
    };
  }
  if (sourceRecordId && !OPTIONAL_ID.test(sourceRecordId)) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      message: "sourceRecordId is invalid.",
    };
  }

  let sourceVersion: number | null = null;
  if (body.sourceVersion !== undefined && body.sourceVersion !== null) {
    if (
      typeof body.sourceVersion !== "number" ||
      !Number.isInteger(body.sourceVersion) ||
      body.sourceVersion < 0
    ) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        message: "sourceVersion must be a non-negative integer.",
      };
    }
    sourceVersion = body.sourceVersion;
  }

  let revenueAmount: string | null = null;
  let revenueCurrency: string | null = null;
  if (body.revenue !== undefined && body.revenue !== null) {
    if (typeof body.revenue !== "object" || Array.isArray(body.revenue)) {
      return {
        ok: false,
        code: "INVALID_REVENUE",
        message: "revenue must be an object.",
      };
    }
    const revenue = body.revenue as Record<string, unknown>;
    revenueAmount = readString(revenue.amount);
    revenueCurrency = readString(revenue.currency);
    if (!revenueAmount || !revenueCurrency) {
      return {
        ok: false,
        code: "INVALID_REVENUE",
        message: "revenue requires amount and currency.",
      };
    }
  }

  return {
    ok: true,
    value: {
      eventId,
      externalLeadId,
      publicLeadId,
      sourceRecordId,
      sourceVersion,
      status,
      effectiveAt,
      revenueAmount,
      revenueCurrency,
    },
  };
}

export function toNormalizedExternalOutcomeEvent(input: {
  integrationId: string;
  sourceSystem: string;
  parsed: ParsedOutcomeEventInput;
}): NormalizedExternalOutcomeEvent {
  return {
    integrationId: input.integrationId,
    sourceSystem: input.sourceSystem,
    sourceRecordId: input.parsed.sourceRecordId,
    sourceEventId: input.parsed.eventId,
    sourceVersion: input.parsed.sourceVersion,
    externalLeadId: input.parsed.externalLeadId,
    publicLeadId: input.parsed.publicLeadId,
    status: input.parsed.status,
    effectiveAt: input.parsed.effectiveAt,
    revenueAmount: input.parsed.revenueAmount,
    revenueCurrency: input.parsed.revenueCurrency,
  };
}

export function mapDomainErrorToIngestionCode(
  message: string,
): OutcomeIngestionErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes("currency")) return "INVALID_CURRENCY";
  if (lower.includes("revenue") || lower.includes("amount")) {
    return "INVALID_REVENUE";
  }
  if (
    lower.includes("time") ||
    lower.includes("future") ||
    lower.includes("date")
  ) {
    return "INVALID_EFFECTIVE_AT";
  }
  return "INVALID_PAYLOAD";
}
