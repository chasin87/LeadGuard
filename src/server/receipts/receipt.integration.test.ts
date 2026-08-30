import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { createTestOwner, deleteTestData } from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import { createMonitor } from "@/server/monitors/service";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import {
  createLeadReceiptVerification,
  processAuthenticatedReceipt,
  processInboundEmailCallback,
  timeoutDueReceiptVerifications,
  timeoutLeadReceiptVerification,
} from "@/server/receipts/service";
import { normalizeInboundMessage } from "@/server/receipts/inbound";
import { hashReceiptSecret } from "@/server/receipts/secrets";
import { createFormSubmissionId } from "@/server/monitoring/form/submission-id";
import { deriveMonitorHealth } from "@/server/incidents/health";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

function uniqueHost(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

async function seedReceiptMonitor(name: string, threshold = 2) {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
  const host = uniqueHost(name.toLowerCase().replace(/\s+/g, "-"));
  const website = await createWebsite(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      name,
      url: host,
    },
    { resolver: publicResolver },
  );
  const monitor = await createMonitor(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      name,
      type: "FORM",
      url: `https://${host}/offerte`,
      intervalSeconds: 21600,
      timeoutMs: 20_000,
      formSelector: "form#quote-form",
      submitSelector: 'button[type="submit"]',
      fieldMappings: [
        { role: "EMAIL", control: "EMAIL", selector: 'input[name="email"]' },
      ],
      successSelector: ".success",
      testDisplayName: "LeadGuard Test",
      testEmail: "leadtests@example.com",
      consented: true,
      consecutiveFailuresBeforeIncident: threshold,
    },
    { resolver: publicResolver },
  );
  await database.formMonitorConfig.update({
    where: { monitorId: monitor.id },
    data: {
      receiptMode: "RECEIPT_WEBHOOK",
      receiptTimeoutMinutes: 15,
      receiptWebhookSecretHash: hashReceiptSecret(
        `lgrw_testsecret_${monitor.id}`,
      ),
      receiptWebhookSecretPrefix: "lgrw_tes…",
    },
  });
  return { owner, website, monitor };
}

async function confirmSubmission(
  seeded: Awaited<ReturnType<typeof seedReceiptMonitor>>,
  submissionId: string,
  method: "WEBHOOK" | "INBOUND_EMAIL" = "WEBHOOK",
) {
  const attempt = await database.formSubmissionAttempt.create({
    data: {
      monitorId: seeded.monitor.id,
      jobId: `job-${submissionId}`,
      submissionId,
      state: "CONFIRMED",
    },
  });
  const now = new Date();
  const { checkId } = await persistAndProcessCheck({
    monitorId: seeded.monitor.id,
    organizationId: seeded.website.organizationId,
    websiteId: seeded.website.id,
    startedAt: now,
    finishedAt: now,
    deferIncident: true,
    result: {
      status: "SUCCESS",
      httpStatus: 200,
      responseTimeMs: 100,
      requestedUrl: seeded.monitor.normalizedUrl,
      finalUrl: seeded.monitor.normalizedUrl,
      redirectCount: 0,
      resolvedIp: "93.184.216.34",
      errorType: null,
      errorMessage: null,
      formDetail: {
        submissionId,
        submissionState: "CONFIRMED",
        successConfirmed: true,
        submissionDurationMs: 80,
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
  const verification = await createLeadReceiptVerification({
    organizationId: seeded.website.organizationId,
    monitorId: seeded.monitor.id,
    monitorCheckId: checkId,
    submissionAttemptId: attempt.id,
    submissionId,
    method,
    timeoutMinutes: 15,
    confirmedAt: now,
  });
  return { checkId, attemptId: attempt.id, verification };
}

describe("lead receipt verification", () => {
  it("moves PENDING to RECEIVED exactly once", async () => {
    const seeded = await seedReceiptMonitor("Receipt received");
    const submissionId = "LG-20260830-RECEIVED0001";
    const created = await confirmSubmission(seeded, submissionId);
    const first = await processAuthenticatedReceipt({
      submissionId,
      organizationId: seeded.website.organizationId,
      monitorId: seeded.monitor.id,
      method: "WEBHOOK",
      receivedAt: new Date(),
    });
    const second = await processAuthenticatedReceipt({
      submissionId,
      organizationId: seeded.website.organizationId,
      monitorId: seeded.monitor.id,
      method: "WEBHOOK",
      receivedAt: new Date(),
    });
    expect(first.kind).toBe("received");
    expect(second.kind).toBe("duplicate");
    const row = await database.leadReceiptVerification.findUniqueOrThrow({
      where: { id: created.verification.id },
    });
    expect(row.status).toBe("RECEIVED");
    expect(row.receivedAt).toBeTruthy();
  });

  it("times out a pending verification and opens an incident after the threshold", async () => {
    const seeded = await seedReceiptMonitor("Receipt timeout incident", 2);
    const firstId = "LG-20260830-TIMEOUT00001";
    const secondId = "LG-20260830-TIMEOUT00002";
    const first = await confirmSubmission(seeded, firstId);
    await database.leadReceiptVerification.update({
      where: { id: first.verification.id },
      data: { timeoutAt: new Date(Date.now() - 1000) },
    });
    expect(await timeoutLeadReceiptVerification(first.verification.id)).toBe(
      "timed_out",
    );
    let incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
    const second = await confirmSubmission(seeded, secondId);
    await database.leadReceiptVerification.update({
      where: { id: second.verification.id },
      data: { timeoutAt: new Date(Date.now() - 1000) },
    });
    await timeoutLeadReceiptVerification(second.verification.id);
    incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident?.status).toBe("OPEN");
    expect(incident?.latestErrorType).toBe("LEAD_RECEIPT_TIMEOUT");
  });

  it("does not open an incident while a receipt is pending", async () => {
    const seeded = await seedReceiptMonitor("Receipt pending quiet");
    await confirmSubmission(seeded, "LG-20260830-PENDING00001");
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
    const health = deriveMonitorHealth({
      latestCheck: { status: "SUCCESS" },
      hasOpenIncident: false,
      receiptStatus: "PENDING",
    });
    expect(health).toBe("pending_confirmation");
  });

  it("records a late receipt without rewriting the timeout failure", async () => {
    const seeded = await seedReceiptMonitor("Receipt late");
    const submissionId = "LG-20260830-LATE00000001";
    const created = await confirmSubmission(seeded, submissionId);
    await database.leadReceiptVerification.update({
      where: { id: created.verification.id },
      data: { timeoutAt: new Date(Date.now() - 60_000) },
    });
    await timeoutLeadReceiptVerification(created.verification.id);
    const afterTimeout =
      await database.leadReceiptVerification.findUniqueOrThrow({
        where: { id: created.verification.id },
      });
    expect(afterTimeout.status).toBe("TIMED_OUT");
    const late = await processAuthenticatedReceipt({
      submissionId,
      organizationId: seeded.website.organizationId,
      monitorId: seeded.monitor.id,
      method: "WEBHOOK",
      receivedAt: new Date(),
    });
    expect(late.kind).toBe("late");
    const row = await database.leadReceiptVerification.findUniqueOrThrow({
      where: { id: created.verification.id },
    });
    expect(row.status).toBe("TIMED_OUT");
    expect(row.lateReceipt).toBe(true);
  });

  it("recovers an incident when the next receipt is received", async () => {
    const seeded = await seedReceiptMonitor("Receipt recovery", 1);
    const failId = "LG-20260830-RECOVERYFAIL";
    const okId = "LG-20260830-RECOVERYOK00";
    const failed = await confirmSubmission(seeded, failId);
    await database.leadReceiptVerification.update({
      where: { id: failed.verification.id },
      data: { timeoutAt: new Date(Date.now() - 1000) },
    });
    await timeoutLeadReceiptVerification(failed.verification.id);
    const open = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id, status: "OPEN" },
    });
    expect(open).toBeTruthy();
    await confirmSubmission(seeded, okId);
    await processAuthenticatedReceipt({
      submissionId: okId,
      organizationId: seeded.website.organizationId,
      monitorId: seeded.monitor.id,
      method: "WEBHOOK",
      receivedAt: new Date(),
    });
    const resolved = await database.incident.findFirst({
      where: { id: open!.id },
    });
    expect(resolved?.status).toBe("RESOLVED");
  });

  it("does not let organization A confirm organization B", async () => {
    const tenantA = await seedReceiptMonitor("Receipt tenant A");
    const tenantB = await seedReceiptMonitor("Receipt tenant B");
    const submissionId = "LG-20260830-CROSSTENANT1";
    await confirmSubmission(tenantB, submissionId);
    const result = await processAuthenticatedReceipt({
      submissionId,
      organizationId: tenantA.website.organizationId,
      monitorId: tenantA.monitor.id,
      method: "WEBHOOK",
      receivedAt: new Date(),
    });
    expect(result.kind).toBe("unknown");
    const row = await database.leadReceiptVerification.findUniqueOrThrow({
      where: { submissionId },
    });
    expect(row.status).toBe("PENDING");
  });

  it("serializes a receipt vs timeout race without corrupting state", async () => {
    const seeded = await seedReceiptMonitor("Receipt race");
    const submissionId = "LG-20260830-RACE00000001";
    const created = await confirmSubmission(seeded, submissionId);
    await database.leadReceiptVerification.update({
      where: { id: created.verification.id },
      data: { timeoutAt: new Date() },
    });
    const [timeoutResult, receiptResult] = await Promise.all([
      timeoutLeadReceiptVerification(created.verification.id),
      processAuthenticatedReceipt({
        submissionId,
        organizationId: seeded.website.organizationId,
        monitorId: seeded.monitor.id,
        method: "WEBHOOK",
        receivedAt: new Date(Date.now() - 1000),
      }),
    ]);
    const row = await database.leadReceiptVerification.findUniqueOrThrow({
      where: { id: created.verification.id },
    });
    expect(["RECEIVED", "TIMED_OUT"]).toContain(row.status);
    expect(
      timeoutResult === "timed_out" ||
        receiptResult.kind === "received" ||
        receiptResult.kind === "late" ||
        receiptResult.kind === "duplicate",
    ).toBe(true);
    if (row.status === "RECEIVED") {
      expect(row.lateReceipt).toBe(false);
    }
  });

  it("confirms a receipt through the fake inbound email provider", async () => {
    const seeded = await seedReceiptMonitor("Receipt inbound");
    const submissionId = createFormSubmissionId();
    await confirmSubmission(seeded, submissionId, "INBOUND_EMAIL");
    const message = normalizeInboundMessage(
      {
        messageId: `msg-${submissionId}-${Date.now()}`,
        recipient: `receipt+${submissionId}@inbound.test`,
        sender: "crm@customer.test",
        subject: "New lead",
        text: "received",
        receivedAt: new Date().toISOString(),
      },
      "generic",
    );
    expect(message).not.toBeNull();
    const first = await processInboundEmailCallback({
      provider: "generic",
      message: message!,
    });
    const second = await processInboundEmailCallback({
      provider: "generic",
      message: message!,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const row = await database.leadReceiptVerification.findUniqueOrThrow({
      where: { submissionId },
    });
    expect(row.status).toBe("RECEIVED");
    expect(row.sourceType).toBe("INBOUND_EMAIL");
  });

  it("does not time out inbound-email receipts when the provider is unconfigured", async () => {
    const seeded = await seedReceiptMonitor("Receipt provider down");
    const submissionId = "LG-20260830-PROVIDERDOWN";
    const created = await confirmSubmission(
      seeded,
      submissionId,
      "INBOUND_EMAIL",
    );
    await database.leadReceiptVerification.update({
      where: { id: created.verification.id },
      data: { timeoutAt: new Date(Date.now() - 1000) },
    });
    const previousDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const previousSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    const previousProvider = process.env.INBOUND_EMAIL_PROVIDER;
    process.env.INBOUND_EMAIL_DOMAIN = "";
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "";
    process.env.INBOUND_EMAIL_PROVIDER = "";
    try {
      await timeoutDueReceiptVerifications(new Date());
    } finally {
      if (previousDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
      else process.env.INBOUND_EMAIL_DOMAIN = previousDomain;
      if (previousSecret === undefined) {
        delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
      } else {
        process.env.INBOUND_EMAIL_WEBHOOK_SECRET = previousSecret;
      }
      if (previousProvider === undefined) {
        delete process.env.INBOUND_EMAIL_PROVIDER;
      } else {
        process.env.INBOUND_EMAIL_PROVIDER = previousProvider;
      }
    }
    const row = await database.leadReceiptVerification.findUniqueOrThrow({
      where: { id: created.verification.id },
    });
    expect(row.status).toBe("PENDING");
    const incident = await database.incident.findFirst({
      where: { monitorId: seeded.monitor.id },
    });
    expect(incident).toBeNull();
  });
});
