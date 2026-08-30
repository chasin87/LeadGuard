import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { MonitorStatus, MonitorType } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { DomainError } from "@/server/authorization/errors";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";
import {
  isSameWebsiteOrigin,
  resolveMonitorUrlAgainstWebsite,
} from "@/lib/urls/normalize-url";
import {
  enqueueBrowserMonitorCheck,
  enqueueFormMonitorCheck,
  enqueueMonitorCheck,
} from "@/jobs/queue";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import {
  MonitorNotFoundError,
  UrlValidationError,
} from "@/server/security/errors";
import {
  resolveSafeOutboundTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import {
  formConsentVersion,
  getFormMonitoringConfig,
} from "@/server/monitoring/form/config";
import { getReceiptConfig } from "@/server/receipts/config";
import {
  generateReceiptWebhookSecret,
  hashReceiptSecret,
  receiptSecretPrefix,
} from "@/server/receipts/secrets";
import {
  isReceiptConfigured,
  monitorHasPendingReceipt,
} from "@/server/receipts/service";
import { getWebsite } from "@/server/websites/service";

const logger = createLogger("monitors");
const recentCheckTake = 25;

const monitorSelect = {
  id: true,
  websiteId: true,
  name: true,
  type: true,
  url: true,
  normalizedUrl: true,
  status: true,
  intervalSeconds: true,
  timeoutMs: true,
  consecutiveFailures: true,
  consecutiveFailuresBeforeIncident: true,
  lastCheckedAt: true,
  nextCheckAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const latestCheckSelect = {
  id: true,
  status: true,
  httpStatus: true,
  responseTimeMs: true,
  errorType: true,
  errorMessage: true,
  finishedAt: true,
  createdAt: true,
  leadReceiptVerification: {
    select: { status: true },
  },
} as const;

export type MonitorRecord = {
  id: string;
  websiteId: string;
  name: string;
  type: MonitorType;
  url: string;
  normalizedUrl: string;
  status: MonitorStatus;
  intervalSeconds: number;
  timeoutMs: number;
  consecutiveFailures: number;
  consecutiveFailuresBeforeIncident: number;
  lastCheckedAt: Date | null;
  nextCheckAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type MonitorMutationOptions = {
  resolver?: DnsResolver;
};

async function getWebsiteForMonitor(
  userId: string,
  organizationSlug: string,
  websiteId: string,
  permission: "monitors:read" | "monitors:manage",
) {
  await requireOrganizationRole(userId, organizationSlug, permission);
  return getWebsite(userId, organizationSlug, websiteId);
}

async function getMonitorForAccess(
  userId: string,
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
  permission: "monitors:read" | "monitors:manage",
) {
  const website = await getWebsiteForMonitor(
    userId,
    organizationSlug,
    websiteId,
    permission,
  );
  const monitor = await database.monitor.findFirst({
    where: {
      id: monitorId,
      websiteId: website.id,
      deletedAt: null,
    },
    select: {
      ...monitorSelect,
      browserConfig: {
        select: {
          viewport: true,
          requiredSelector: true,
          requiredElementName: true,
        },
      },
      formConfig: {
        select: {
          viewport: true,
          formSelector: true,
          submitSelector: true,
          cookieAcceptSelector: true,
          fieldMappings: true,
          successMode: true,
          successSelector: true,
          successUrlPattern: true,
          successText: true,
          submissionTimeoutMs: true,
          testProfileId: true,
          configurationStatus: true,
          lastValidatedAt: true,
          lastValidationResult: true,
          consentedAt: true,
          consentVersion: true,
          receiptMode: true,
          receiptTimeoutMinutes: true,
          receiptWebhookSecretPrefix: true,
          receiptVerifiedAt: true,
          testProfile: {
            select: {
              id: true,
              name: true,
              displayName: true,
              email: true,
              phone: true,
              plusAddressing: true,
            },
          },
        },
      },
    },
  });
  if (!monitor) {
    throw new MonitorNotFoundError();
  }
  return { website, monitor };
}

async function validateMonitorUrl(
  url: string,
  website: {
    id: string;
    organizationId: string;
    normalizedUrl: string;
    hostname: string;
    scheme: string;
    port: number;
  },
  userId: string,
  resolver?: DnsResolver,
) {
  let parsed;
  try {
    parsed = resolveMonitorUrlAgainstWebsite(url, website.normalizedUrl);
  } catch (error) {
    if (error instanceof UrlValidationError) {
      logger.warn("monitor.validation_failed", {
        organizationId: website.organizationId,
        websiteId: website.id,
        userId,
        reason: error.reason,
        hostname: website.hostname,
      });
    }
    throw error;
  }

  if (!isSameWebsiteOrigin(website, parsed)) {
    throw new UrlValidationError(
      "Monitor URLs must stay on the same host as the website.",
      "origin_only",
    );
  }

  try {
    await resolveSafeOutboundTarget(parsed.normalizedUrl, {
      resolver,
      originOnly: false,
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      logger.warn("monitor.validation_failed", {
        organizationId: website.organizationId,
        websiteId: website.id,
        userId,
        reason: error.reason,
        hostname: parsed.hostname,
      });
    }
    throw error;
  }

  return parsed;
}

export async function listMonitors(
  userId: string,
  organizationSlug: string,
  websiteId: string,
) {
  const website = await getWebsiteForMonitor(
    userId,
    organizationSlug,
    websiteId,
    "monitors:read",
  );
  const monitors = await database.monitor.findMany({
    where: { websiteId: website.id, deletedAt: null },
    select: {
      ...monitorSelect,
      checks: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: latestCheckSelect,
      },
      incidents: {
        where: { status: "OPEN" },
        take: 1,
        select: {
          id: true,
          startedAt: true,
          detectedAt: true,
          latestErrorType: true,
          latestHttpStatus: true,
          failureCount: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return monitors.map(({ checks, incidents, ...monitor }) => ({
    ...monitor,
    latestCheck: checks[0] ?? null,
    openIncident: incidents[0] ?? null,
  }));
}

export async function getMonitor(
  userId: string,
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
) {
  const { monitor } = await getMonitorForAccess(
    userId,
    organizationSlug,
    websiteId,
    monitorId,
    "monitors:read",
  );
  const [latestCheck, openIncident] = await Promise.all([
    database.monitorCheck.findFirst({
      where: { monitorId: monitor.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        httpStatus: true,
        responseTimeMs: true,
        requestedUrl: true,
        finalUrl: true,
        redirectCount: true,
        errorType: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        soft404Score: true,
        soft404ClassifierVersion: true,
        soft404Signals: true,
        browserDetail: {
          select: {
            viewport: true,
            navigationDurationMs: true,
            totalDurationMs: true,
            javascriptErrorCount: true,
            pageErrorCount: true,
            failedResourceCount: true,
            requiredElementFound: true,
            renderedTextLength: true,
            screenshotKey: true,
            screenshotCapturedAt: true,
            javascriptErrors: true,
            failedResources: true,
            dialogOccurred: true,
          },
        },
        formDetail: {
          select: {
            submissionId: true,
            submissionState: true,
            successConfirmed: true,
            submissionDurationMs: true,
            submitHttpStatus: true,
            submitEndpointPath: true,
            submitMethod: true,
            fieldsExpectedCount: true,
            fieldsFoundCount: true,
            formFound: true,
            submitClicked: true,
            captchaDetected: true,
            validationErrors: true,
            unmappedRequiredFields: true,
            screenshotKey: true,
            screenshotCapturedAt: true,
          },
        },
        leadReceiptVerification: {
          select: {
            id: true,
            status: true,
            method: true,
            timeoutAt: true,
            receivedAt: true,
            receiptLatencyMs: true,
            lateReceipt: true,
            sourceType: true,
            submissionId: true,
          },
        },
      },
    }),
    database.incident.findFirst({
      where: { monitorId: monitor.id, status: "OPEN" },
      select: {
        id: true,
        startedAt: true,
        detectedAt: true,
        latestErrorType: true,
        latestHttpStatus: true,
        failureCount: true,
      },
    }),
  ]);
  return { ...monitor, latestCheck, openIncident };
}

export async function listMonitorChecks(
  userId: string,
  organizationSlug: string,
  websiteId: string,
  monitorId: string,
) {
  const { monitor } = await getMonitorForAccess(
    userId,
    organizationSlug,
    websiteId,
    monitorId,
    "monitors:read",
  );
  return database.monitorCheck.findMany({
    where: { monitorId: monitor.id },
    orderBy: { createdAt: "desc" },
    take: recentCheckTake,
    select: {
      id: true,
      status: true,
      httpStatus: true,
      responseTimeMs: true,
      errorType: true,
      errorMessage: true,
      finishedAt: true,
      createdAt: true,
      soft404Score: true,
      soft404ClassifierVersion: true,
      soft404Signals: true,
      browserDetail: {
        select: {
          viewport: true,
          navigationDurationMs: true,
          totalDurationMs: true,
          javascriptErrorCount: true,
          pageErrorCount: true,
          failedResourceCount: true,
          requiredElementFound: true,
          renderedTextLength: true,
          screenshotKey: true,
          screenshotCapturedAt: true,
          javascriptErrors: true,
          failedResources: true,
          dialogOccurred: true,
        },
      },
      formDetail: {
        select: {
          submissionId: true,
          submissionState: true,
          successConfirmed: true,
          submitHttpStatus: true,
          submitEndpointPath: true,
          submitClicked: true,
          screenshotKey: true,
        },
      },
      leadReceiptVerification: {
        select: {
          status: true,
          method: true,
          lateReceipt: true,
          receiptLatencyMs: true,
        },
      },
    },
  });
}

export async function createMonitor(
  input: {
    userId: string;
    organizationSlug: string;
    websiteId: string;
    name: string;
    url: string;
    intervalSeconds: number;
    timeoutMs: number;
    consecutiveFailuresBeforeIncident?: number;
    type?: MonitorType;
    viewport?: "DESKTOP" | "MOBILE";
    requiredSelector?: string;
    requiredElementName?: string;
    formSelector?: string;
    submitSelector?: string;
    cookieAcceptSelector?: string;
    fieldMappings?: unknown;
    successMode?: "ANY" | "SELECTOR" | "URL" | "TEXT";
    successSelector?: string;
    successUrlPattern?: string;
    successText?: string;
    submissionTimeoutMs?: number;
    testProfileId?: string;
    testProfileName?: string;
    testDisplayName?: string;
    testEmail?: string;
    testPhone?: string;
    testPostcode?: string;
    testCity?: string;
    testCompany?: string;
    plusAddressing?: boolean;
    consented?: boolean;
  },
  options: MonitorMutationOptions = {},
) {
  const website = await getWebsiteForMonitor(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    "monitors:manage",
  );
  const parsed = await validateMonitorUrl(
    input.url,
    website,
    input.userId,
    options.resolver,
  );
  const type = input.type ?? "HTTP";
  if (type === "AD_DESTINATION") {
    throw new DomainError(
      "Ad destination monitors are created from Google Ads sync.",
    );
  }
  const requiredSelector = input.requiredSelector?.trim() || null;
  const requiredElementName = input.requiredElementName?.trim() || null;

  if (type === "FORM") {
    const formLimits = getFormMonitoringConfig();
    const existing = await database.monitor.count({
      where: {
        type: "FORM",
        deletedAt: null,
        website: { organizationId: website.organizationId },
      },
    });
    if (existing >= formLimits.maxPerOrganization) {
      throw new DomainError(
        "This organization has reached the form monitor limit.",
      );
    }
    if (!input.consented) {
      throw new DomainError(
        "Confirm that this form is safe for automated test submissions.",
      );
    }
  }

  try {
    const testProfileId =
      type === "FORM"
        ? await resolveFormTestProfile({
            organizationId: website.organizationId,
            userId: input.userId,
            testProfileId: input.testProfileId,
            name: input.testProfileName || `${input.name.trim()} profile`,
            displayName: input.testDisplayName || "LeadGuard Test",
            email: input.testEmail,
            phone: input.testPhone,
            postcode: input.testPostcode,
            city: input.testCity,
            company: input.testCompany,
            plusAddressing: input.plusAddressing,
          })
        : null;

    const monitor = await database.monitor.create({
      data: {
        websiteId: website.id,
        name: input.name.trim(),
        type,
        url: parsed.normalizedUrl,
        normalizedUrl: parsed.normalizedUrl,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        consecutiveFailuresBeforeIncident:
          input.consecutiveFailuresBeforeIncident ?? 2,
        status: type === "FORM" ? "PAUSED" : "ACTIVE",
        nextCheckAt:
          type === "FORM"
            ? new Date(Date.now() + input.intervalSeconds * 1000)
            : new Date(),
        browserConfig:
          type === "BROWSER"
            ? {
                create: {
                  viewport: input.viewport ?? "DESKTOP",
                  requiredSelector,
                  requiredElementName,
                },
              }
            : undefined,
        formConfig:
          type === "FORM"
            ? {
                create: {
                  viewport: input.viewport ?? "DESKTOP",
                  formSelector: input.formSelector ?? "",
                  submitSelector: input.submitSelector ?? "",
                  cookieAcceptSelector: input.cookieAcceptSelector || null,
                  fieldMappings: (input.fieldMappings ??
                    []) as Prisma.InputJsonValue,
                  successMode: input.successMode ?? "ANY",
                  successSelector: input.successSelector || null,
                  successUrlPattern: input.successUrlPattern || null,
                  successText: input.successText || null,
                  submissionTimeoutMs: input.submissionTimeoutMs ?? 20_000,
                  testProfileId,
                  configurationStatus: "UNVERIFIED",
                  consentedAt: new Date(),
                  consentedByUserId: input.userId,
                  consentVersion: formConsentVersion,
                },
              }
            : undefined,
      },
      select: monitorSelect,
    });
    logger.info("monitor.created", {
      organizationId: website.organizationId,
      websiteId: website.id,
      monitorId: monitor.id,
      userId: input.userId,
      type,
    });
    return monitor;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new UrlValidationError(
        "A monitor of this type already exists for this page.",
        "duplicate_website",
      );
    }
    throw error;
  }
}

export async function updateMonitor(
  input: {
    userId: string;
    organizationSlug: string;
    websiteId: string;
    monitorId: string;
    name: string;
    url: string;
    intervalSeconds: number;
    timeoutMs: number;
    status: MonitorStatus;
    consecutiveFailuresBeforeIncident: number;
    viewport?: "DESKTOP" | "MOBILE";
    requiredSelector?: string;
    requiredElementName?: string;
    formSelector?: string;
    submitSelector?: string;
    cookieAcceptSelector?: string;
    fieldMappings?: unknown;
    successMode?: "ANY" | "SELECTOR" | "URL" | "TEXT";
    successSelector?: string;
    successUrlPattern?: string;
    successText?: string;
    submissionTimeoutMs?: number;
    testProfileId?: string;
    testProfileName?: string;
    testDisplayName?: string;
    testEmail?: string;
    testPhone?: string;
    plusAddressing?: boolean;
  },
  options: MonitorMutationOptions = {},
) {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  const parsed =
    monitor.type === "AD_DESTINATION"
      ? {
          normalizedUrl: monitor.normalizedUrl,
        }
      : await validateMonitorUrl(
          input.url,
          website,
          input.userId,
          options.resolver,
        );
  const requiredSelector = input.requiredSelector?.trim() || null;
  const requiredElementName = input.requiredElementName?.trim() || null;
  let nextStatus = input.status;
  if (monitor.type === "FORM") {
    const current = monitor.formConfig;
    const formChanged =
      (input.formSelector ?? "") !== (current?.formSelector ?? "") ||
      (input.submitSelector ?? "") !== (current?.submitSelector ?? "") ||
      JSON.stringify(input.fieldMappings ?? []) !==
        JSON.stringify(current?.fieldMappings ?? []) ||
      (input.successSelector || null) !== (current?.successSelector ?? null) ||
      (input.successUrlPattern || null) !==
        (current?.successUrlPattern ?? null) ||
      (input.successText || null) !== (current?.successText ?? null);
    if (formChanged) nextStatus = "PAUSED";
    if (nextStatus === "ACTIVE") {
      assertFormMonitorCanActivate(current);
    }
  }
  const resuming = monitor.status === "PAUSED" && nextStatus === "ACTIVE";

  try {
    const updated = await database.monitor.updateMany({
      where: {
        id: monitor.id,
        websiteId: website.id,
        deletedAt: null,
      },
      data: {
        name: input.name.trim(),
        url: parsed.normalizedUrl,
        normalizedUrl: parsed.normalizedUrl,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        status: nextStatus,
        consecutiveFailuresBeforeIncident:
          input.consecutiveFailuresBeforeIncident,
        nextCheckAt: resuming ? new Date() : undefined,
      },
    });
    if (updated.count !== 1) {
      throw new MonitorNotFoundError();
    }
    if (monitor.type === "BROWSER") {
      await database.browserMonitorConfig.upsert({
        where: { monitorId: monitor.id },
        update: {
          viewport: input.viewport ?? "DESKTOP",
          requiredSelector,
          requiredElementName,
        },
        create: {
          monitorId: monitor.id,
          viewport: input.viewport ?? "DESKTOP",
          requiredSelector,
          requiredElementName,
        },
      });
    }
    if (monitor.type === "FORM") {
      const testProfileId = input.testProfileId
        ? await resolveFormTestProfile({
            organizationId: website.organizationId,
            userId: input.userId,
            testProfileId: input.testProfileId,
            name: input.testProfileName || `${input.name.trim()} profile`,
            displayName: input.testDisplayName || "LeadGuard Test",
            email: input.testEmail,
            phone: input.testPhone,
            plusAddressing: input.plusAddressing,
          })
        : (monitor.formConfig?.testProfileId ?? null);
      await database.formMonitorConfig.upsert({
        where: { monitorId: monitor.id },
        update: {
          viewport: input.viewport ?? "DESKTOP",
          formSelector: input.formSelector ?? "",
          submitSelector: input.submitSelector ?? "",
          cookieAcceptSelector: input.cookieAcceptSelector || null,
          fieldMappings: (input.fieldMappings ?? []) as Prisma.InputJsonValue,
          successMode: input.successMode ?? "ANY",
          successSelector: input.successSelector || null,
          successUrlPattern: input.successUrlPattern || null,
          successText: input.successText || null,
          submissionTimeoutMs: input.submissionTimeoutMs ?? 20_000,
          testProfileId,
          configurationStatus: "UNVERIFIED",
        },
        create: {
          monitorId: monitor.id,
          viewport: input.viewport ?? "DESKTOP",
          formSelector: input.formSelector ?? "",
          submitSelector: input.submitSelector ?? "",
          cookieAcceptSelector: input.cookieAcceptSelector || null,
          fieldMappings: (input.fieldMappings ?? []) as Prisma.InputJsonValue,
          successMode: input.successMode ?? "ANY",
          successSelector: input.successSelector || null,
          successUrlPattern: input.successUrlPattern || null,
          successText: input.successText || null,
          submissionTimeoutMs: input.submissionTimeoutMs ?? 20_000,
          testProfileId,
        },
      });
    }
    logger.info("monitor.updated", {
      organizationId: website.organizationId,
      websiteId: website.id,
      monitorId: monitor.id,
      userId: input.userId,
    });
    return getMonitor(
      input.userId,
      input.organizationSlug,
      input.websiteId,
      input.monitorId,
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new UrlValidationError(
        "A monitor of this type already exists for this page.",
        "duplicate_website",
      );
    }
    throw error;
  }
}

export async function setMonitorStatus(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  status: MonitorStatus;
}) {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  const resuming = monitor.status === "PAUSED" && input.status === "ACTIVE";
  if (monitor.type === "FORM" && input.status === "ACTIVE") {
    assertFormMonitorCanActivate(monitor.formConfig);
  }
  if (monitor.type === "AD_DESTINATION") {
    await database.adDestinationConfig.updateMany({
      where: { monitorId: monitor.id },
      data: { userPaused: input.status === "PAUSED" },
    });
    if (input.status === "ACTIVE") {
      const target = await database.googleAdsDestinationTarget.findFirst({
        where: { monitorId: monitor.id },
        select: { hasActiveSource: true },
      });
      if (!target?.hasActiveSource) {
        throw new DomainError(
          "This destination has no active Google Ads source.",
        );
      }
    }
  }
  await database.monitor.updateMany({
    where: { id: monitor.id, websiteId: website.id, deletedAt: null },
    data: {
      status: input.status,
      nextCheckAt: resuming ? new Date() : undefined,
    },
  });
  logger.info("monitor.updated", {
    organizationId: website.organizationId,
    websiteId: website.id,
    monitorId: monitor.id,
    userId: input.userId,
  });
}

export async function deleteMonitor(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
}) {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  await database.monitor.updateMany({
    where: { id: monitor.id, websiteId: website.id, deletedAt: null },
    data: { deletedAt: new Date(), status: "PAUSED" },
  });
  logger.info("monitor.deleted", {
    organizationId: website.organizationId,
    websiteId: website.id,
    monitorId: monitor.id,
    userId: input.userId,
  });
}

export async function enqueueManualMonitorCheck(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
}): Promise<{ queued: boolean; message: string }> {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  if (website.status !== "ACTIVE") {
    throw new DomainError("This website is disabled.");
  }
  if (monitor.type === "FORM") {
    throw new DomainError(
      "Form monitors use Validate configuration or Send real test lead.",
    );
  }
  if (monitor.status !== "ACTIVE") {
    throw new DomainError("Resume the monitor before running a check.");
  }
  const cooldownMs = monitor.type === "BROWSER" ? 30_000 : 15_000;
  const limit = consumeRateLimit(`monitor-manual:${monitor.id}`, 1, cooldownMs);
  if (!limit.ok) {
    throw new DomainError("Wait a few seconds before running another check.");
  }
  const enqueue =
    monitor.type === "BROWSER"
      ? enqueueBrowserMonitorCheck
      : enqueueMonitorCheck;
  const jobId = await enqueue({
    monitorId: monitor.id,
    hostname: website.hostname,
    organizationId: website.organizationId,
    websiteId: website.id,
    source: "manual",
  });
  if (!jobId) {
    return {
      queued: false,
      message: "A check is already queued or running for this monitor.",
    };
  }
  return { queued: true, message: "Check queued." };
}

export async function enqueueFormValidation(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
}): Promise<{ queued: boolean; message: string }> {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  if (monitor.type !== "FORM") {
    throw new DomainError("Only form monitors can validate configuration.");
  }
  if (website.status !== "ACTIVE") {
    throw new DomainError("This website is disabled.");
  }
  const limit = consumeRateLimit(`form-validate:${monitor.id}`, 1, 30_000);
  if (!limit.ok) {
    throw new DomainError("Wait a few seconds before validating again.");
  }
  const jobId = await enqueueFormMonitorCheck({
    monitorId: monitor.id,
    hostname: website.hostname,
    organizationId: website.organizationId,
    websiteId: website.id,
    source: "manual",
    mode: "validate",
  });
  if (!jobId) {
    return {
      queued: false,
      message: "A form job is already queued or running for this monitor.",
    };
  }
  return { queued: true, message: "Configuration validation queued." };
}

export async function enqueueFormRealTest(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  confirmed: boolean;
}): Promise<{ queued: boolean; message: string }> {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  if (monitor.type !== "FORM") {
    throw new DomainError("Only form monitors can send a test lead.");
  }
  if (website.status !== "ACTIVE") {
    throw new DomainError("This website is disabled.");
  }
  if (!input.confirmed) {
    throw new DomainError(
      "Confirm that this will submit a real test lead through the configured form.",
    );
  }
  if (!monitor.formConfig?.consentedAt) {
    throw new DomainError(
      "Confirm that this form is safe for automated test submissions.",
    );
  }
  if (await monitorHasPendingReceipt(monitor.id)) {
    throw new DomainError(
      "Wait for the previous lead receipt to complete before sending another test.",
    );
  }
  const cooldown = getFormMonitoringConfig().manualCooldownMs;
  const limit = consumeRateLimit(`form-submit:${monitor.id}`, 1, cooldown);
  if (!limit.ok) {
    throw new DomainError(
      "Wait at least 5 minutes before sending another test lead.",
    );
  }
  const jobId = await enqueueFormMonitorCheck({
    monitorId: monitor.id,
    hostname: website.hostname,
    organizationId: website.organizationId,
    websiteId: website.id,
    source: "manual",
    mode: "submit",
  });
  if (!jobId) {
    return {
      queued: false,
      message: "A form job is already queued or running for this monitor.",
    };
  }
  return { queued: true, message: "Real test lead queued." };
}

function assertFormMonitorCanActivate(
  config:
    | {
        configurationStatus: string;
        consentedAt: Date | null;
        receiptMode?: string;
        receiptVerifiedAt?: Date | null;
      }
    | null
    | undefined,
) {
  if (!config?.consentedAt) {
    throw new DomainError(
      "Confirm that this form is safe for automated test submissions.",
    );
  }
  if (config.configurationStatus !== "VERIFIED") {
    throw new DomainError(
      "Send a successful real test lead before enabling scheduled tests.",
    );
  }
  if (config.receiptMode && config.receiptMode !== "NONE") {
    if (
      !isReceiptConfigured(
        config.receiptMode as "NONE" | "INBOUND_EMAIL" | "RECEIPT_WEBHOOK",
      )
    ) {
      throw new DomainError(
        "Inbound email receipt verification is not configured on this LeadGuard instance.",
      );
    }
    if (!config.receiptVerifiedAt) {
      throw new DomainError(
        "Confirm a downstream receipt before enabling scheduled tests.",
      );
    }
  }
}

async function resolveFormTestProfile(input: {
  organizationId: string;
  userId: string;
  testProfileId?: string;
  name: string;
  displayName: string;
  email?: string;
  phone?: string;
  postcode?: string;
  city?: string;
  company?: string;
  plusAddressing?: boolean;
}): Promise<string> {
  if (input.testProfileId) {
    const existing = await database.formTestProfile.findFirst({
      where: {
        id: input.testProfileId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!existing) {
      throw new DomainError("Test profile not found.");
    }
    return existing.id;
  }
  if (!input.email) {
    throw new DomainError("Enter a test email address.");
  }
  try {
    const created = await database.formTestProfile.create({
      data: {
        organizationId: input.organizationId,
        name: input.name.slice(0, 80),
        displayName: input.displayName.slice(0, 80),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        postcode: input.postcode?.trim() || null,
        city: input.city?.trim() || null,
        company: input.company?.trim() || null,
        plusAddressing: Boolean(input.plusAddressing),
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await database.formTestProfile.findFirst({
        where: { organizationId: input.organizationId, name: input.name },
        select: { id: true },
      });
      if (existing) return existing.id;
      throw new DomainError("A test profile with this name already exists.");
    }
    throw error;
  }
}

export async function updateFormReceiptSettings(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  receiptMode: "NONE" | "INBOUND_EMAIL" | "RECEIPT_WEBHOOK";
  receiptTimeoutMinutes: number;
}): Promise<{ webhookSecret?: string }> {
  const { website, monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  if (monitor.type !== "FORM" || !monitor.formConfig) {
    throw new DomainError("Only form monitors support receipt verification.");
  }
  const stored = await database.formMonitorConfig.findUnique({
    where: { monitorId: monitor.id },
    select: {
      receiptWebhookSecretHash: true,
      receiptWebhookSecretPrefix: true,
    },
  });
  const receiptConfig = getReceiptConfig();
  if (
    input.receiptTimeoutMinutes < receiptConfig.minTimeoutMinutes ||
    input.receiptTimeoutMinutes > receiptConfig.maxTimeoutMinutes
  ) {
    throw new DomainError("Receipt timeout must be between 1 and 120 minutes.");
  }
  if (!isReceiptConfigured(input.receiptMode)) {
    throw new DomainError(
      "Inbound email receipt verification is not configured on this LeadGuard instance.",
    );
  }
  const previous = monitor.formConfig.receiptMode;
  const modeChanged = previous !== input.receiptMode;
  let webhookSecret: string | undefined;
  let secretHash = stored?.receiptWebhookSecretHash ?? null;
  let secretPrefix = stored?.receiptWebhookSecretPrefix ?? null;
  if (input.receiptMode === "RECEIPT_WEBHOOK" && !secretHash) {
    webhookSecret = generateReceiptWebhookSecret();
    secretHash = hashReceiptSecret(webhookSecret);
    secretPrefix = receiptSecretPrefix(webhookSecret);
  }
  const pauseForReverify =
    modeChanged && input.receiptMode !== "NONE" && monitor.status === "ACTIVE";
  await database.$transaction(async (tx) => {
    await tx.formMonitorConfig.update({
      where: { monitorId: monitor.id },
      data: {
        receiptMode: input.receiptMode,
        receiptTimeoutMinutes: input.receiptTimeoutMinutes,
        receiptWebhookSecretHash: secretHash,
        receiptWebhookSecretPrefix: secretPrefix,
        receiptVerifiedAt:
          input.receiptMode === "NONE" || !modeChanged
            ? (monitor.formConfig?.receiptVerifiedAt ?? null)
            : null,
      },
    });
    if (pauseForReverify) {
      await tx.monitor.update({
        where: { id: monitor.id },
        data: { status: "PAUSED" },
      });
    }
  });
  logger.info("monitor.updated", {
    organizationId: website.organizationId,
    websiteId: website.id,
    monitorId: monitor.id,
    userId: input.userId,
  });
  return webhookSecret ? { webhookSecret } : {};
}

export async function rotateFormReceiptWebhookSecret(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
}): Promise<string> {
  const { monitor } = await getMonitorForAccess(
    input.userId,
    input.organizationSlug,
    input.websiteId,
    input.monitorId,
    "monitors:manage",
  );
  if (monitor.type !== "FORM" || !monitor.formConfig) {
    throw new DomainError("Only form monitors support receipt verification.");
  }
  if (monitor.formConfig.receiptMode !== "RECEIPT_WEBHOOK") {
    throw new DomainError("Enable webhook receipt verification first.");
  }
  const webhookSecret = generateReceiptWebhookSecret();
  await database.formMonitorConfig.update({
    where: { monitorId: monitor.id },
    data: {
      receiptWebhookSecretHash: hashReceiptSecret(webhookSecret),
      receiptWebhookSecretPrefix: receiptSecretPrefix(webhookSecret),
      receiptVerifiedAt: null,
    },
  });
  if (monitor.status === "ACTIVE") {
    await database.monitor.update({
      where: { id: monitor.id },
      data: { status: "PAUSED" },
    });
  }
  return webhookSecret;
}
