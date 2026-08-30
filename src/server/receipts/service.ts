import { Prisma } from "@/generated/prisma/client";
import type {
  LeadReceiptMethod,
  LeadReceiptMode,
} from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import {
  applyReceiptRecovery,
  persistAndProcessCheck,
} from "@/server/incidents/engine";
import { getReceiptConfig } from "@/server/receipts/config";
import {
  senderDomainFromAddress,
  submissionIdFromInboundEmail,
  type NormalizedInboundEmail,
} from "@/server/receipts/inbound";

const logger = createLogger("receipts");

export type ReceiptProcessResult =
  | { kind: "received" }
  | { kind: "duplicate" }
  | { kind: "late" }
  | { kind: "unknown" };

type LockedOutcome =
  | { kind: "received"; verificationId: string }
  | { kind: "duplicate" }
  | { kind: "unknown" }
  | { kind: "late"; verificationId: string; openedTimeout: boolean };

export async function createLeadReceiptVerification(input: {
  organizationId: string;
  monitorId: string;
  monitorCheckId: string;
  submissionAttemptId: string;
  submissionId: string;
  method: LeadReceiptMethod;
  timeoutMinutes: number;
  confirmedAt: Date;
}): Promise<{ id: string; timeoutAt: Date }> {
  const timeoutAt = new Date(
    input.confirmedAt.getTime() + input.timeoutMinutes * 60_000,
  );
  const created = await database.leadReceiptVerification.upsert({
    where: { submissionAttemptId: input.submissionAttemptId },
    update: {},
    create: {
      organizationId: input.organizationId,
      monitorId: input.monitorId,
      monitorCheckId: input.monitorCheckId,
      submissionAttemptId: input.submissionAttemptId,
      submissionId: input.submissionId,
      method: input.method,
      status: "PENDING",
      expectedAt: input.confirmedAt,
      timeoutAt,
    },
    select: { id: true, timeoutAt: true },
  });
  logger.info("receipt.verification.created", {
    organizationId: input.organizationId,
    monitorId: input.monitorId,
    monitorCheckId: input.monitorCheckId,
    verificationId: created.id,
    submissionId: input.submissionId,
    method: input.method,
  });
  logger.info("receipt.pending", {
    organizationId: input.organizationId,
    monitorId: input.monitorId,
    verificationId: created.id,
    submissionId: input.submissionId,
    method: input.method,
  });
  return created;
}

export async function processAuthenticatedReceipt(input: {
  submissionId: string;
  organizationId: string;
  monitorId: string;
  method: LeadReceiptMethod;
  receivedAt: Date;
  providerMessageId?: string;
  senderDomain?: string | null;
  subjectPreview?: string | null;
}): Promise<ReceiptProcessResult> {
  const locked = await database.$transaction(async (tx) => {
    const verification = await tx.leadReceiptVerification.findUnique({
      where: { submissionId: input.submissionId },
    });
    if (
      !verification ||
      verification.organizationId !== input.organizationId ||
      verification.monitorId !== input.monitorId
    ) {
      logger.info("receipt.unknown", {
        organizationId: input.organizationId,
        monitorId: input.monitorId,
        submissionId: input.submissionId,
        method: input.method,
      });
      return { kind: "unknown" } satisfies LockedOutcome;
    }
    await tx.$queryRaw`
      SELECT id FROM "LeadReceiptVerification" WHERE id = ${verification.id} FOR UPDATE
    `;
    const current = await tx.leadReceiptVerification.findUniqueOrThrow({
      where: { id: verification.id },
    });
    if (current.status === "RECEIVED") {
      logger.info("receipt.duplicate", {
        organizationId: current.organizationId,
        monitorId: current.monitorId,
        verificationId: current.id,
        submissionId: current.submissionId,
        method: input.method,
      });
      return { kind: "duplicate" } satisfies LockedOutcome;
    }
    const meta = {
      sourceType: input.method,
      providerMessageId: input.providerMessageId,
      senderDomain: input.senderDomain,
      subjectPreview: input.subjectPreview,
    };
    if (current.status === "PENDING") {
      if (input.receivedAt.getTime() <= current.timeoutAt.getTime()) {
        const latency = Math.max(
          0,
          input.receivedAt.getTime() - current.expectedAt.getTime(),
        );
        await tx.leadReceiptVerification.update({
          where: { id: current.id },
          data: {
            status: "RECEIVED",
            receivedAt: input.receivedAt,
            receiptLatencyMs: latency,
            lateReceipt: false,
            ...meta,
          },
        });
        return {
          kind: "received",
          verificationId: current.id,
        } satisfies LockedOutcome;
      }
      await tx.leadReceiptVerification.update({
        where: { id: current.id },
        data: {
          status: "TIMED_OUT",
          receivedAt: input.receivedAt,
          lateReceipt: true,
          ...meta,
        },
      });
      return {
        kind: "late",
        verificationId: current.id,
        openedTimeout: true,
      } satisfies LockedOutcome;
    }
    await tx.leadReceiptVerification.update({
      where: { id: current.id },
      data: {
        receivedAt: current.receivedAt ?? input.receivedAt,
        lateReceipt: true,
        sourceType: current.sourceType ?? input.method,
        providerMessageId: current.providerMessageId ?? input.providerMessageId,
        senderDomain: current.senderDomain ?? input.senderDomain,
        subjectPreview: current.subjectPreview ?? input.subjectPreview,
      },
    });
    logger.info("receipt.received_late", {
      organizationId: current.organizationId,
      monitorId: current.monitorId,
      verificationId: current.id,
      submissionId: current.submissionId,
      method: input.method,
    });
    return {
      kind: "late",
      verificationId: current.id,
      openedTimeout: false,
    } satisfies LockedOutcome;
  });

  if (locked.kind === "received") {
    await afterReceived(locked.verificationId);
    return { kind: "received" };
  }
  if (locked.kind === "late") {
    if (locked.openedTimeout) await afterTimedOut(locked.verificationId);
    return { kind: "late" };
  }
  return { kind: locked.kind };
}

export async function timeoutLeadReceiptVerification(
  verificationId: string,
  now = new Date(),
): Promise<"timed_out" | "noop"> {
  const outcome = await database.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "LeadReceiptVerification" WHERE id = ${verificationId} FOR UPDATE
    `;
    const locked = await tx.leadReceiptVerification.findUnique({
      where: { id: verificationId },
    });
    if (!locked) return "noop" as const;
    if (
      locked.status === "PENDING" &&
      now.getTime() >= locked.timeoutAt.getTime()
    ) {
      await tx.leadReceiptVerification.update({
        where: { id: locked.id },
        data: { status: "TIMED_OUT" },
      });
      return "timed_out" as const;
    }
    return "noop" as const;
  });
  if (outcome === "timed_out") {
    await afterTimedOut(verificationId);
  }
  return outcome;
}

export async function timeoutDueReceiptVerifications(now = new Date()) {
  const config = getReceiptConfig();
  const due = await database.leadReceiptVerification.findMany({
    where: { status: "PENDING", timeoutAt: { lte: now } },
    select: { id: true, method: true, organizationId: true, monitorId: true },
    take: 50,
    orderBy: { timeoutAt: "asc" },
  });
  let timedOut = 0;
  for (const row of due) {
    if (row.method === "INBOUND_EMAIL" && !config.inboundReady) {
      logger.warn("receipt.timeout.skipped_provider_unavailable", {
        organizationId: row.organizationId,
        monitorId: row.monitorId,
        verificationId: row.id,
        method: row.method,
      });
      continue;
    }
    const result = await timeoutLeadReceiptVerification(row.id, now);
    if (result === "timed_out") timedOut += 1;
  }
  return timedOut;
}

async function afterReceived(verificationId: string) {
  const verification = await database.leadReceiptVerification.findUnique({
    where: { id: verificationId },
    include: {
      monitor: {
        select: {
          id: true,
          deletedAt: true,
          website: { select: { id: true, organizationId: true } },
        },
      },
    },
  });
  if (!verification) return;
  logger.info("receipt.received", {
    organizationId: verification.organizationId,
    monitorId: verification.monitorId,
    monitorCheckId: verification.monitorCheckId,
    verificationId: verification.id,
    submissionId: verification.submissionId,
    method: verification.method,
  });
  if (verification.monitor.deletedAt) return;
  await applyReceiptRecovery({
    monitorId: verification.monitorId,
    organizationId: verification.organizationId,
    websiteId: verification.monitor.website.id,
    recoveryCheckId: verification.monitorCheckId,
    recoveredAt: verification.receivedAt ?? new Date(),
  });
  await database.formMonitorConfig.updateMany({
    where: { monitorId: verification.monitorId },
    data: {
      receiptVerifiedAt: new Date(),
      configurationStatus: "VERIFIED",
    },
  });
}

async function afterTimedOut(verificationId: string) {
  const verification = await database.leadReceiptVerification.findUnique({
    where: { id: verificationId },
    include: {
      check: {
        select: {
          requestedUrl: true,
          finalUrl: true,
          resolvedIp: true,
        },
      },
      monitor: {
        select: {
          id: true,
          deletedAt: true,
          website: { select: { id: true } },
        },
      },
    },
  });
  if (!verification || verification.monitor.deletedAt) return;
  logger.info("receipt.timed_out", {
    organizationId: verification.organizationId,
    monitorId: verification.monitorId,
    monitorCheckId: verification.monitorCheckId,
    verificationId: verification.id,
    submissionId: verification.submissionId,
    method: verification.method,
  });
  const existing = await database.monitorCheck.findFirst({
    where: {
      monitorId: verification.monitorId,
      errorType: "LEAD_RECEIPT_TIMEOUT",
      formDetail: { submissionId: verification.submissionId },
    },
    select: { id: true },
  });
  if (existing) return;
  const now = new Date();
  await persistAndProcessCheck({
    monitorId: verification.monitorId,
    organizationId: verification.organizationId,
    websiteId: verification.monitor.website.id,
    startedAt: verification.expectedAt,
    finishedAt: now,
    result: {
      status: "FAILURE",
      httpStatus: 200,
      responseTimeMs: Math.max(
        0,
        now.getTime() - verification.expectedAt.getTime(),
      ),
      requestedUrl: verification.check.requestedUrl,
      finalUrl: verification.check.finalUrl,
      redirectCount: 0,
      resolvedIp: verification.check.resolvedIp,
      errorType: "LEAD_RECEIPT_TIMEOUT",
      errorMessage:
        "The form accepted the test lead, but LeadGuard could not confirm that the lead was received downstream.",
      formDetail: {
        submissionId: verification.submissionId,
        submissionState: "CONFIRMED",
        successConfirmed: true,
        submissionDurationMs: null,
        submitHttpStatus: null,
        submitEndpointPath: null,
        submitMethod: null,
        fieldsExpectedCount: 0,
        fieldsFoundCount: 0,
        formFound: true,
        submitClicked: true,
        captchaDetected: false,
        validationErrors: null,
        unmappedRequiredFields: null,
      },
    },
  });
}

export async function processInboundEmailCallback(input: {
  provider: string;
  message: NormalizedInboundEmail;
}): Promise<{ duplicate: boolean }> {
  const submissionId = submissionIdFromInboundEmail(input.message);
  const verification = submissionId
    ? await database.leadReceiptVerification.findUnique({
        where: { submissionId },
        select: { organizationId: true, monitorId: true, method: true },
      })
    : null;
  const recorded = await recordInboundEmailMessage({
    organizationId: verification?.organizationId ?? null,
    provider: input.provider,
    message: input.message,
    submissionId,
  });
  if (recorded.duplicate) return { duplicate: true };
  if (
    !verification ||
    verification.method !== "INBOUND_EMAIL" ||
    !submissionId
  ) {
    return { duplicate: false };
  }
  await processAuthenticatedReceipt({
    submissionId,
    organizationId: verification.organizationId,
    monitorId: verification.monitorId,
    method: "INBOUND_EMAIL",
    receivedAt: input.message.receivedAt,
    providerMessageId: input.message.messageId,
    senderDomain: senderDomainFromAddress(input.message.sender),
    subjectPreview: input.message.subject.slice(0, 120) || null,
  });
  return { duplicate: false };
}

export async function recordInboundEmailMessage(input: {
  organizationId: string | null;
  provider: string;
  message: NormalizedInboundEmail;
  submissionId: string | null;
}): Promise<{ duplicate: boolean }> {
  try {
    await database.inboundEmailMessage.create({
      data: {
        organizationId: input.organizationId,
        provider: input.provider,
        providerMessageId: input.message.messageId,
        submissionId: input.submissionId,
        recipient: input.message.recipient.slice(0, 200),
        senderDomain: senderDomainFromAddress(input.message.sender),
        subjectPreview: input.message.subject.slice(0, 120) || null,
        receivedAt: input.message.receivedAt,
      },
    });
    return { duplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { duplicate: true };
    }
    throw error;
  }
}

export async function monitorHasPendingReceipt(monitorId: string) {
  const pending = await database.leadReceiptVerification.findFirst({
    where: { monitorId, status: "PENDING" },
    select: { id: true },
  });
  return Boolean(pending);
}

export function receiptMethodForMode(
  mode: LeadReceiptMode,
): LeadReceiptMethod | null {
  if (mode === "INBOUND_EMAIL") return "INBOUND_EMAIL";
  if (mode === "RECEIPT_WEBHOOK") return "WEBHOOK";
  return null;
}

export function isReceiptConfigured(mode: LeadReceiptMode) {
  if (mode === "NONE") return true;
  if (mode === "RECEIPT_WEBHOOK") return true;
  return getReceiptConfig().inboundSelectable;
}
