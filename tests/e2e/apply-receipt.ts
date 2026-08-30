import { config } from "dotenv";
import { database } from "@/server/database";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import {
  createLeadReceiptVerification,
  processAuthenticatedReceipt,
  timeoutLeadReceiptVerification,
} from "@/server/receipts/service";
import { createFormSubmissionId } from "@/server/monitoring/form/submission-id";

config({ path: ".env" });

async function main() {
  const monitorId = process.argv[2];
  const mode = process.argv[3] ?? "pending";
  if (!monitorId || !["pending", "received", "timeout"].includes(mode)) {
    throw new Error(
      "Usage: apply-receipt.ts <monitorId> <pending|received|timeout>",
    );
  }

  const monitor = await database.monitor.findUnique({
    where: { id: monitorId },
    select: {
      id: true,
      normalizedUrl: true,
      website: { select: { id: true, organizationId: true } },
      formConfig: {
        select: { receiptTimeoutMinutes: true, receiptMode: true },
      },
    },
  });
  if (!monitor) {
    throw new Error("Monitor not found.");
  }

  const now = new Date();
  const submissionId = createFormSubmissionId(now);
  const attempt = await database.formSubmissionAttempt.create({
    data: {
      monitorId: monitor.id,
      jobId: `e2e-receipt-${submissionId}`,
      submissionId,
      state: "CONFIRMED",
    },
  });
  const { checkId } = await persistAndProcessCheck({
    monitorId: monitor.id,
    organizationId: monitor.website.organizationId,
    websiteId: monitor.website.id,
    startedAt: now,
    finishedAt: now,
    deferIncident: true,
    result: {
      status: "SUCCESS",
      httpStatus: 200,
      responseTimeMs: 900,
      requestedUrl: monitor.normalizedUrl,
      finalUrl: monitor.normalizedUrl,
      redirectCount: 0,
      resolvedIp: "93.184.216.34",
      errorType: null,
      errorMessage: null,
      formDetail: {
        submissionId,
        submissionState: "CONFIRMED",
        successConfirmed: true,
        submissionDurationMs: 800,
        submitHttpStatus: 200,
        submitEndpointPath: "/thanks",
        submitMethod: "POST",
        fieldsExpectedCount: 1,
        fieldsFoundCount: 1,
        formFound: true,
        submitClicked: true,
        captchaDetected: false,
        validationErrors: null,
        unmappedRequiredFields: null,
      },
    },
  });
  await database.formSubmissionAttempt.update({
    where: { id: attempt.id },
    data: { checkId },
  });
  const method =
    monitor.formConfig?.receiptMode === "INBOUND_EMAIL"
      ? "INBOUND_EMAIL"
      : "WEBHOOK";
  const verification = await createLeadReceiptVerification({
    organizationId: monitor.website.organizationId,
    monitorId: monitor.id,
    monitorCheckId: checkId,
    submissionAttemptId: attempt.id,
    submissionId,
    method,
    timeoutMinutes: monitor.formConfig?.receiptTimeoutMinutes ?? 15,
    confirmedAt: now,
  });

  if (mode === "timeout") {
    await database.leadReceiptVerification.update({
      where: { id: verification.id },
      data: { timeoutAt: new Date(Date.now() - 1000) },
    });
    await timeoutLeadReceiptVerification(verification.id);
  }
  if (mode === "received") {
    await processAuthenticatedReceipt({
      submissionId,
      organizationId: monitor.website.organizationId,
      monitorId: monitor.id,
      method,
      receivedAt: new Date(),
    });
  }

  process.stdout.write(`${submissionId}\n`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
