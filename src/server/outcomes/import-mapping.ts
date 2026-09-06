import { LEAD_OUTCOME_STATUSES } from "@/server/leads/outcome";
import type { LeadOutcomeStatus } from "@/generated/prisma/enums";
import type { ParsedOutcomeEventInput } from "@/server/outcomes/normalize";

export const IMPORT_FIELDS = [
  "externalLeadId",
  "publicLeadId",
  "sourceRecordId",
  "sourceEventId",
  "status",
  "effectiveAt",
  "revenueAmount",
  "revenueCurrency",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export type OutcomeImportMapping = {
  columns: Partial<Record<ImportField, string>>;
  statusMap: Record<string, LeadOutcomeStatus>;
  defaultCurrency: string | null;
  effectiveAtPolicy: "column" | "import_timestamp";
};

export function parseOutcomeImportMapping(
  raw: string,
): OutcomeImportMapping | null {
  try {
    const parsed = JSON.parse(raw) as OutcomeImportMapping;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      columns: parsed.columns ?? {},
      statusMap: parsed.statusMap ?? {},
      defaultCurrency: parsed.defaultCurrency ?? null,
      effectiveAtPolicy:
        parsed.effectiveAtPolicy === "column" ? "column" : "import_timestamp",
    };
  } catch {
    return null;
  }
}

export function mappingHasMatchColumn(mapping: OutcomeImportMapping): boolean {
  return Boolean(
    mapping.columns.externalLeadId ||
    mapping.columns.publicLeadId ||
    mapping.columns.sourceRecordId,
  );
}

function cell(
  headers: string[],
  row: string[],
  column: string | undefined,
): string {
  if (!column) return "";
  const index = headers.indexOf(column);
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

export function mapImportRow(input: {
  headers: string[];
  row: string[];
  rowNumber: number;
  importId: string;
  mapping: OutcomeImportMapping;
  now: Date;
}):
  | { ok: true; parsed: ParsedOutcomeEventInput }
  | {
      ok: false;
      code:
        | "INVALID_STATUS"
        | "INVALID_PAYLOAD"
        | "INVALID_EFFECTIVE_AT"
        | "INVALID_REVENUE";
    } {
  const statusRaw = cell(
    input.headers,
    input.row,
    input.mapping.columns.status,
  );
  if (!statusRaw) {
    return { ok: false, code: "INVALID_STATUS" };
  }
  const mappedStatus =
    input.mapping.statusMap[statusRaw] ??
    LEAD_OUTCOME_STATUSES.find((item) => item === statusRaw) ??
    null;
  if (!mappedStatus) {
    return { ok: false, code: "INVALID_STATUS" };
  }

  const sourceEventId =
    cell(input.headers, input.row, input.mapping.columns.sourceEventId) ||
    `import:${input.importId}:${input.rowNumber}`;
  const externalLeadId =
    cell(input.headers, input.row, input.mapping.columns.externalLeadId) ||
    null;
  const publicLeadId =
    cell(input.headers, input.row, input.mapping.columns.publicLeadId) || null;
  const sourceRecordId =
    cell(input.headers, input.row, input.mapping.columns.sourceRecordId) ||
    null;
  if (!externalLeadId && !publicLeadId && !sourceRecordId) {
    return { ok: false, code: "INVALID_PAYLOAD" };
  }

  let effectiveAt = input.now;
  if (input.mapping.effectiveAtPolicy === "column") {
    const raw = cell(
      input.headers,
      input.row,
      input.mapping.columns.effectiveAt,
    );
    if (!raw) return { ok: false, code: "INVALID_EFFECTIVE_AT" };
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, code: "INVALID_EFFECTIVE_AT" };
    }
    effectiveAt = parsed;
  }

  const amount = cell(
    input.headers,
    input.row,
    input.mapping.columns.revenueAmount,
  );
  const currency =
    cell(input.headers, input.row, input.mapping.columns.revenueCurrency) ||
    input.mapping.defaultCurrency ||
    "";
  let revenueAmount: string | null = null;
  let revenueCurrency: string | null = null;
  if (amount) {
    if (!currency) return { ok: false, code: "INVALID_REVENUE" };
    revenueAmount = amount;
    revenueCurrency = currency;
  }

  return {
    ok: true,
    parsed: {
      eventId: sourceEventId,
      externalLeadId,
      publicLeadId,
      sourceRecordId,
      sourceVersion: null,
      status: mappedStatus,
      effectiveAt,
      revenueAmount,
      revenueCurrency,
    },
  };
}
