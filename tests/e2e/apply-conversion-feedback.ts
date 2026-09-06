import { config } from "dotenv";
import { database } from "@/server/database";
import {
  planGoogleConversionExport,
  pollGoogleConversionExportStatus,
  submitGoogleConversionExport,
} from "@/server/google-ads/conversion-export";
import {
  resetFakeDataManagerWorld,
  type FakeDataManagerMode,
} from "@/server/google-data-manager/fake";

if (!process.env.DATABASE_URL) {
  config({ path: process.env.E2E_ENV_FILE ?? ".env" });
}

const terminal = new Set([
  "SUCCEEDED",
  "REJECTED",
  "NEEDS_REVIEW",
  "CANCELLED",
  "OUT_OF_SYNC",
  "BLOCKED",
]);

async function main() {
  const leadId = process.argv[2];
  const mode = process.argv[3] as FakeDataManagerMode | undefined;
  if (!leadId) {
    throw new Error("Usage: apply-conversion-feedback.ts <leadId> [mode]");
  }
  if (mode) {
    resetFakeDataManagerWorld({ mode });
  }
  const lead = await database.lead.findUnique({
    where: { id: leadId },
    select: { id: true, organizationId: true },
  });
  if (!lead) throw new Error("Lead not found.");
  const planned = await planGoogleConversionExport({
    leadId: lead.id,
    organizationId: lead.organizationId,
  });
  if (!planned) {
    throw new Error("Conversion export was not planned.");
  }
  for (let index = 0; index < 8; index += 1) {
    const row = await database.googleAdsConversionExport.findFirst({
      where: { leadId: lead.id },
    });
    if (!row) throw new Error("Conversion export row missing.");
    if (terminal.has(row.status)) return;
    if (row.dataManagerRequestId && row.status === "PROCESSING") {
      await pollGoogleConversionExportStatus({ exportId: row.id });
      continue;
    }
    if (
      row.status === "READY" ||
      row.status === "RETRYABLE_ERROR" ||
      row.status === "SUBMITTING"
    ) {
      await submitGoogleConversionExport({ exportId: row.id });
    }
  }
  throw new Error("Conversion export did not reach a terminal status.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await database.$disconnect();
  });
