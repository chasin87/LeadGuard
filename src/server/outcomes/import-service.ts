import "server-only";

import { database } from "@/server/database";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { requireOrganizationMembership } from "@/server/authorization/organization";
import { getArtifactStorage } from "@/server/storage";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";
import { parseCsvText, TabularParseError } from "@/server/outcomes/csv";
import { parseXlsxBuffer } from "@/server/outcomes/xlsx";
import {
  mapImportRow,
  mappingHasMatchColumn,
  parseOutcomeImportMapping,
  type OutcomeImportMapping,
} from "@/server/outcomes/import-mapping";
import { ingestParsedOutcomeEvent } from "@/server/outcomes/service";
import { incrementOutcomeIngestionMetric } from "@/server/outcomes/metrics";
import { enqueueOutcomeImport } from "@/jobs/queue";
import { requireFeature } from "@/server/billing/limits";
import { createLogger } from "@/server/logger";
import type {
  ExternalOutcomeEventStatus,
  OutcomeImportFileType,
} from "@/generated/prisma/enums";

const logger = createLogger("outcome-import");

async function requireImportManage(userId: string, organizationSlug: string) {
  const context = await requireOrganizationMembership(userId, organizationSlug);
  if (!hasOrganizationPermission(context.membership.role, "leads:manage")) {
    throw new AuthorizationError();
  }
  if (
    !hasOrganizationPermission(context.membership.role, "integrations:manage")
  ) {
    throw new AuthorizationError();
  }
  return context;
}

function detectFileType(fileName: string): OutcomeImportFileType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "XLSX";
  if (lower.endsWith(".csv")) return "CSV";
  throw new DomainError("Upload a CSV or XLSX file.");
}

export function parseImportFile(
  fileName: string,
  body: Buffer,
): ReturnType<typeof parseCsvText> {
  const config = getOutcomeIngestionConfig();
  if (body.length > config.importMaxFileBytes) {
    throw new DomainError("File exceeds the 10 MB limit.");
  }
  const type = detectFileType(fileName);
  try {
    if (type === "CSV") return parseCsvText(body.toString("utf8"));
    return parseXlsxBuffer(body);
  } catch (error) {
    if (error instanceof TabularParseError) {
      throw new DomainError(error.message);
    }
    throw error;
  }
}

export function importStorageKey(
  organizationId: string,
  importId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  return `outcome-imports/${organizationId}/${importId}/${safe}`;
}

export async function createOutcomeImport(input: {
  userId: string;
  organizationSlug: string;
  integrationId: string;
  fileName: string;
  body: Buffer;
}) {
  const context = await requireImportManage(
    input.userId,
    input.organizationSlug,
  );
  const integration = await database.externalOutcomeIntegration.findFirst({
    where: {
      id: input.integrationId,
      organizationId: context.organization.id,
    },
  });
  if (!integration) throw new DomainError("Integration not found.");
  await requireFeature(context.organization.id, "csvImports");
  const parsed = parseImportFile(input.fileName, input.body);
  const created = await database.outcomeImport.create({
    data: {
      organizationId: context.organization.id,
      integrationId: integration.id,
      createdByUserId: input.userId,
      fileName: input.fileName.slice(0, 180),
      fileType: detectFileType(input.fileName),
      storageKey: "pending",
      mappingJson: "{}",
      status: "UPLOADED",
      totalRows: parsed.rows.length,
    },
  });
  const storageKey = importStorageKey(
    context.organization.id,
    created.id,
    input.fileName,
  );
  await getArtifactStorage().put(
    storageKey,
    input.body,
    created.fileType === "CSV" ? "text/csv" : "application/vnd.ms-excel",
  );
  const updated = await database.outcomeImport.update({
    where: { id: created.id },
    data: { storageKey },
  });
  return { importRecord: updated, headers: parsed.headers, parsed };
}

export async function saveOutcomeImportMapping(input: {
  userId: string;
  organizationSlug: string;
  importId: string;
  mapping: OutcomeImportMapping;
}) {
  const context = await requireImportManage(
    input.userId,
    input.organizationSlug,
  );
  if (!mappingHasMatchColumn(input.mapping)) {
    throw new DomainError(
      "Map at least one of externalLeadId, publicLeadId or sourceRecordId.",
    );
  }
  if (
    input.mapping.effectiveAtPolicy === "column" &&
    !input.mapping.columns.effectiveAt
  ) {
    throw new DomainError("Select an effective-at column or use import time.");
  }
  const updated = await database.outcomeImport.updateMany({
    where: {
      id: input.importId,
      organizationId: context.organization.id,
      status: { in: ["UPLOADED", "PREVIEWED"] },
    },
    data: {
      mappingJson: JSON.stringify(input.mapping),
      status: "PREVIEWED",
    },
  });
  if (updated.count !== 1) throw new DomainError("Import not found.");
}

export async function previewOutcomeImport(input: {
  userId: string;
  organizationSlug: string;
  importId: string;
  dryRun: boolean;
}) {
  const context = await requireOrganizationMembership(
    input.userId,
    input.organizationSlug,
  );
  if (
    !hasOrganizationPermission(context.membership.role, "integrations:read")
  ) {
    throw new AuthorizationError();
  }
  const record = await database.outcomeImport.findFirst({
    where: {
      id: input.importId,
      organizationId: context.organization.id,
    },
    include: { integration: true },
  });
  if (!record) throw new DomainError("Import not found.");
  const mapping = parseOutcomeImportMapping(record.mappingJson);
  const stored = await getArtifactStorage().get(record.storageKey);
  if (!stored) throw new DomainError("Import file is no longer available.");
  const parsed = parseImportFile(record.fileName, stored.body);
  const config = getOutcomeIngestionConfig();
  const preview = parsed.rows.slice(0, config.previewRows).map((row, index) => {
    const rowNumber = index + 2;
    if (!mapping) {
      return {
        rowNumber,
        result: "REJECTED" as const,
        leadId: null,
        errorCode: "INVALID_PAYLOAD",
      };
    }
    const mapped = mapImportRow({
      headers: parsed.headers,
      row,
      rowNumber,
      importId: record.id,
      mapping,
      now: new Date(),
    });
    if (!mapped.ok) {
      return {
        rowNumber,
        result: "REJECTED" as const,
        leadId: null,
        errorCode: mapped.code,
      };
    }
    return { rowNumber, mapped: mapped.parsed };
  });
  if (!input.dryRun || !mapping) {
    return { record, headers: parsed.headers, preview };
  }
  const results = [];
  for (const item of preview) {
    if (!("mapped" in item) || !item.mapped) {
      results.push(item);
      continue;
    }
    const ingested = await ingestParsedOutcomeEvent({
      integration: {
        id: record.integration.id,
        organizationId: record.integration.organizationId,
        name: record.integration.name,
        type: record.integration.type,
        status: record.integration.status,
        authMode: record.integration.authMode,
        sourceSystem: record.integration.sourceSystem,
        credentialPrefix: record.integration.credentialPrefix,
      },
      parsed: item.mapped,
      persist: false,
      outcomeSource: "CSV_IMPORT",
    });
    results.push({
      rowNumber: item.rowNumber,
      result: ingested.status,
      leadId: ingested.leadId,
      errorCode: ingested.errorCode,
    });
  }
  return { record, headers: parsed.headers, preview: results };
}

export async function confirmOutcomeImport(input: {
  userId: string;
  organizationSlug: string;
  importId: string;
}) {
  const context = await requireImportManage(
    input.userId,
    input.organizationSlug,
  );
  const record = await database.outcomeImport.findFirst({
    where: {
      id: input.importId,
      organizationId: context.organization.id,
    },
  });
  if (!record) throw new DomainError("Import not found.");
  const mapping = parseOutcomeImportMapping(record.mappingJson);
  if (!mapping || !mappingHasMatchColumn(mapping)) {
    throw new DomainError("Save a column mapping before importing.");
  }
  if (record.status === "QUEUED" || record.status === "PROCESSING") {
    return record;
  }
  if (
    record.status === "COMPLETED" ||
    record.status === "COMPLETED_WITH_ERRORS"
  ) {
    return record;
  }
  const updated = await database.outcomeImport.update({
    where: { id: record.id },
    data: { status: "QUEUED" },
  });
  await enqueueOutcomeImport({
    importId: updated.id,
    organizationId: updated.organizationId,
  });
  logger.info("outcome_import.started", {
    organizationId: updated.organizationId,
    importId: updated.id,
  });
  return updated;
}

function bumpCount(status: ExternalOutcomeEventStatus):
  | keyof Pick<
      {
        appliedRows: number;
        unmatchedRows: number;
        rejectedRows: number;
        staleRows: number;
        conflictRows: number;
        duplicateRows: number;
      },
      | "appliedRows"
      | "unmatchedRows"
      | "rejectedRows"
      | "staleRows"
      | "conflictRows"
      | "duplicateRows"
    >
  | null {
  if (status === "APPLIED") return "appliedRows";
  if (status === "UNMATCHED" || status === "AMBIGUOUS") return "unmatchedRows";
  if (status === "REJECTED") return "rejectedRows";
  if (status === "STALE") return "staleRows";
  if (status === "CONFLICT") return "conflictRows";
  if (status === "DUPLICATE") return "duplicateRows";
  return "rejectedRows";
}

export async function processOutcomeImport(importId: string): Promise<void> {
  const record = await database.outcomeImport.findUnique({
    where: { id: importId },
    include: { integration: true },
  });
  if (!record) return;
  if (
    record.status === "COMPLETED" ||
    record.status === "COMPLETED_WITH_ERRORS"
  ) {
    return;
  }
  const mapping = parseOutcomeImportMapping(record.mappingJson);
  if (!mapping) {
    await database.outcomeImport.update({
      where: { id: record.id },
      data: {
        status: "FAILED",
        errorMessage: "Missing mapping.",
        completedAt: new Date(),
      },
    });
    return;
  }
  const stored = await getArtifactStorage().get(record.storageKey);
  if (!stored) {
    await database.outcomeImport.update({
      where: { id: record.id },
      data: {
        status: "FAILED",
        errorMessage: "Import file is no longer available.",
        completedAt: new Date(),
      },
    });
    return;
  }
  const parsed = parseImportFile(record.fileName, stored.body);
  const config = getOutcomeIngestionConfig();
  await database.outcomeImport.update({
    where: { id: record.id },
    data: {
      status: "PROCESSING",
      startedAt: record.startedAt ?? new Date(),
      totalRows: parsed.rows.length,
    },
  });
  const integration = {
    id: record.integration.id,
    organizationId: record.integration.organizationId,
    name: record.integration.name,
    type: record.integration.type,
    status: record.integration.status,
    authMode: record.integration.authMode,
    sourceSystem: record.integration.sourceSystem,
    credentialPrefix: record.integration.credentialPrefix,
  };
  let processed = record.processedRows;
  for (let i = record.processedRows; i < parsed.rows.length; i += 1) {
    const rowNumber = i + 2;
    const existingRow = await database.outcomeImportRow.findUnique({
      where: {
        importId_rowNumber: { importId: record.id, rowNumber },
      },
    });
    if (existingRow) {
      processed = i + 1;
      continue;
    }
    const mapped = mapImportRow({
      headers: parsed.headers,
      row: parsed.rows[i]!,
      rowNumber,
      importId: record.id,
      mapping,
      now: new Date(),
    });
    let status: ExternalOutcomeEventStatus = "REJECTED";
    let errorCode: string | null = mapped.ok ? null : mapped.code;
    let matchedLeadId: string | null = null;
    if (mapped.ok) {
      const ingested = await ingestParsedOutcomeEvent({
        integration,
        parsed: mapped.parsed,
        persist: true,
        outcomeSource: "CSV_IMPORT",
      });
      status = ingested.status;
      errorCode = ingested.errorCode;
      matchedLeadId = ingested.leadId;
    }
    await database.outcomeImportRow.create({
      data: {
        importId: record.id,
        rowNumber,
        sourceEventId: mapped.ok
          ? mapped.parsed.eventId
          : `import:${record.id}:${rowNumber}`,
        status,
        errorCode,
        matchedLeadId,
      },
    });
    const field = bumpCount(status);
    processed = i + 1;
    incrementOutcomeIngestionMetric("outcome_import_rows_total");
    await database.outcomeImport.update({
      where: { id: record.id },
      data: {
        processedRows: processed,
        ...(field ? { [field]: { increment: 1 } } : {}),
      },
    });
    if ((i + 1) % config.importBatchSize === 0) {
      continue;
    }
  }
  const finished = await database.outcomeImport.findUniqueOrThrow({
    where: { id: record.id },
  });
  const hasErrors =
    finished.rejectedRows +
      finished.unmatchedRows +
      finished.staleRows +
      finished.conflictRows >
    0;
  await database.outcomeImport.update({
    where: { id: record.id },
    data: {
      status: hasErrors ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      completedAt: new Date(),
      processedRows: parsed.rows.length,
    },
  });
  logger.info("outcome_import.completed", {
    organizationId: record.organizationId,
    importId: record.id,
    hasErrors,
  });
}

export async function cleanupExpiredOutcomeImports(now = new Date()) {
  const days = getOutcomeIngestionConfig().importFileRetentionDays;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const expired = await database.outcomeImport.findMany({
    where: { createdAt: { lt: cutoff }, storageKey: { not: "" } },
    select: { id: true, storageKey: true },
    take: 100,
  });
  const storage = getArtifactStorage();
  for (const row of expired) {
    try {
      await storage.delete(row.storageKey);
    } catch {
      continue;
    }
    await database.outcomeImport.update({
      where: { id: row.id },
      data: { storageKey: "" },
    });
  }
  return expired.length;
}
