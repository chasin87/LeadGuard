import { config } from "dotenv";
import { database } from "@/server/database";
import { persistAndProcessCheck } from "@/server/incidents/engine";

config({ path: ".env" });

async function main() {
  const monitorId = process.argv[2];
  const mode = process.argv[3] ?? "FAILURE";
  if (!monitorId) {
    throw new Error("Usage: apply-form-check.ts <monitorId> <FAILURE|SUCCESS>");
  }

  const monitor = await database.monitor.findUnique({
    where: { id: monitorId },
    select: {
      id: true,
      normalizedUrl: true,
      website: { select: { id: true, organizationId: true } },
    },
  });
  if (!monitor) {
    throw new Error("Monitor not found.");
  }

  const now = new Date();
  const failed = mode !== "SUCCESS";
  await persistAndProcessCheck({
    monitorId: monitor.id,
    organizationId: monitor.website.organizationId,
    websiteId: monitor.website.id,
    startedAt: now,
    finishedAt: new Date(now.getTime() + 1200),
    result: {
      status: failed ? "FAILURE" : "SUCCESS",
      httpStatus: failed ? 500 : 200,
      responseTimeMs: 1200,
      requestedUrl: monitor.normalizedUrl,
      finalUrl: monitor.normalizedUrl,
      redirectCount: 0,
      resolvedIp: "93.184.216.34",
      errorType: failed ? "FORM_SUBMISSION_FAILED" : null,
      errorMessage: failed ? "Form submission failed." : null,
    },
  });
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
