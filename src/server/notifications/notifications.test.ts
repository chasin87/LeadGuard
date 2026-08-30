import { afterAll, afterEach, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { createWebsite } from "@/server/websites/service";
import { createMonitor } from "@/server/monitors/service";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import { insertIncidentOutboxEvent } from "@/server/notifications/outbox";
import { dispatchPendingOutboxEvents } from "@/server/notifications/dispatcher";
import { processDelivery } from "@/server/notifications/delivery";
import {
  createEmailChannel,
  createWebhookChannel,
  listIncidentDeliveries,
  listNotificationChannels,
  revealWebhookSecret,
  sendTestNotification,
  updateNotificationChannel,
} from "@/server/notifications/service";
import { setEmailProviderOverride } from "@/server/notifications/email/provider";
import {
  createMemoryEmailProvider,
  createScriptedEmailProvider,
} from "@/server/notifications/email/memory";
import { setWebhookTransportOverrides } from "@/server/notifications/webhooks/send";
import { sendSignedWebhook } from "@/server/notifications/webhooks/send";
import {
  signWebhookBody,
  webhookSignaturesMatch,
} from "@/server/notifications/webhooks/signature";
import { escapeHtml } from "@/server/notifications/templates/layout";
import { createEmailChannelSchema } from "@/lib/validation/notification";
import { AuthorizationError } from "@/server/authorization/errors";
import { stopNotificationQueue } from "@/jobs/queue";
import { resetRateLimitStore } from "@/server/auth/rate-limit";
import type { HttpCheckResult } from "@/server/monitoring/http-check";
import type { DnsResolver } from "@/server/security/ssrf";
import type { PinnedHttpTransport } from "@/server/monitoring/pinned-transport";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicIpv4 = "93.184.216.34";
const publicResolver: DnsResolver = async () => [publicIpv4];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
  await stopNotificationQueue().catch(() => undefined);
});

afterEach(() => {
  setEmailProviderOverride(undefined);
  setWebhookTransportOverrides({});
  resetRateLimitStore();
});

function uniqueHost(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

let sequence = 0;
function nextWindow() {
  sequence += 1;
  const startedAt = new Date(Date.UTC(2026, 7, 30, 15, sequence, 0));
  const finishedAt = new Date(startedAt.getTime() + 200);
  return { startedAt, finishedAt };
}

function checkResult(
  partial: Partial<HttpCheckResult> & Pick<HttpCheckResult, "status">,
): HttpCheckResult {
  return {
    httpStatus: null,
    responseTimeMs: 40,
    requestedUrl: "https://example.com/page",
    finalUrl: "https://example.com/page",
    redirectCount: 0,
    resolvedIp: publicIpv4,
    errorType: null,
    errorMessage: null,
    ...partial,
  };
}

async function seedMonitor(name: string) {
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
      name: `${name} monitor`,
      url: `https://${host}/page`,
      intervalSeconds: 300,
      timeoutMs: 10_000,
      consecutiveFailuresBeforeIncident: 2,
    },
    { resolver: publicResolver },
  );
  return { ...owner, website, monitor, host };
}

async function applyCheck(
  seeded: Awaited<ReturnType<typeof seedMonitor>>,
  result: HttpCheckResult,
) {
  const times = nextWindow();
  return persistAndProcessCheck({
    monitorId: seeded.monitor.id,
    organizationId: seeded.organization.id,
    websiteId: seeded.website.id,
    startedAt: times.startedAt,
    finishedAt: times.finishedAt,
    result,
  });
}

async function openIncident(seeded: Awaited<ReturnType<typeof seedMonitor>>) {
  await applyCheck(
    seeded,
    checkResult({
      status: "FAILURE",
      httpStatus: 404,
      errorType: "HTTP_404",
    }),
  );
  const opened = await applyCheck(
    seeded,
    checkResult({
      status: "FAILURE",
      httpStatus: 404,
      errorType: "HTTP_404",
    }),
  );
  expect(opened.outcome.kind).toBe("opened");
  return opened.outcome.kind === "opened" ? opened.outcome.incidentId : "";
}

describe("notification outbox idempotency", () => {
  it("inserts a single opened event when the same transition is written twice", async () => {
    const seeded = await seedMonitor("Idempotent Outbox");
    const incidentId = await openIncident(seeded);
    await database.$transaction(async (tx) => {
      const first = await insertIncidentOutboxEvent(tx, {
        organizationId: seeded.organization.id,
        websiteId: seeded.website.id,
        monitorId: seeded.monitor.id,
        incidentId,
        eventType: "INCIDENT_OPENED",
        startedAt: new Date(),
        detectedAt: new Date(),
        resolvedAt: null,
        errorType: "HTTP_404",
        httpStatus: 404,
        recoveryHttpStatus: null,
      });
      const second = await insertIncidentOutboxEvent(tx, {
        organizationId: seeded.organization.id,
        websiteId: seeded.website.id,
        monitorId: seeded.monitor.id,
        incidentId,
        eventType: "INCIDENT_OPENED",
        startedAt: new Date(),
        detectedAt: new Date(),
        resolvedAt: null,
        errorType: "HTTP_404",
        httpStatus: 404,
        recoveryHttpStatus: null,
      });
      expect(first).toBe("duplicate");
      expect(second).toBe("duplicate");
    });
    expect(
      await database.notificationOutboxEvent.count({
        where: { aggregateId: incidentId, eventType: "INCIDENT_OPENED" },
      }),
    ).toBe(1);
  });
});

describe("notification fan-out", () => {
  it("creates three deliveries for two emails and one webhook", async () => {
    const seeded = await seedMonitor("Fan Out");
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Operations",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Owner",
      email: "owner@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    await createWebhookChannel(
      {
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        name: "Automation",
        url: `https://${seeded.host}/hooks`,
        notifyOnOpened: true,
        notifyOnResolved: true,
      },
      { resolver: publicResolver },
    );
    const incidentId = await openIncident(seeded);
    await dispatchPendingOutboxEvents();
    const deliveries = await database.notificationDelivery.findMany({
      where: { incidentId },
    });
    expect(deliveries).toHaveLength(3);
  });

  it("skips disabled channels and honours preferences", async () => {
    const seeded = await seedMonitor("Prefs");
    const active = await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Active",
      email: "active@example.com",
      notifyOnOpened: true,
      notifyOnResolved: false,
    });
    const disabled = await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Disabled",
      email: "disabled@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    await updateNotificationChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      channelId: disabled.id,
      name: disabled.name,
      email: "disabled@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
      status: "DISABLED",
    });
    const incidentId = await openIncident(seeded);
    await dispatchPendingOutboxEvents();
    const opened = await database.notificationDelivery.findMany({
      where: { incidentId, eventType: "INCIDENT_OPENED" },
    });
    expect(opened.map((row) => row.channelId)).toEqual([active.id]);

    await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    await dispatchPendingOutboxEvents();
    expect(
      await database.notificationDelivery.count({
        where: { incidentId, eventType: "INCIDENT_RESOLVED" },
      }),
    ).toBe(0);
  });
});

describe("email and webhook delivery", () => {
  it("sends an opened email through a fake provider", async () => {
    const seeded = await seedMonitor("Email Flow");
    const inbox = createMemoryEmailProvider();
    setEmailProviderOverride(inbox);
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Operations",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    const incidentId = await openIncident(seeded);
    await dispatchPendingOutboxEvents();
    const delivery = await database.notificationDelivery.findFirst({
      where: { incidentId },
    });
    expect(delivery).toBeTruthy();
    await processDelivery(delivery!.id);
    const sent = await database.notificationDelivery.findUnique({
      where: { id: delivery!.id },
    });
    expect(sent?.status).toBe("SENT");
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]?.to).toBe("ops@example.com");
    expect(inbox.messages[0]?.subject).toContain("Incident");
    expect(inbox.messages[0]?.text).toContain("LeadGuard detected a problem");
    expect(inbox.messages[0]?.html).toContain("LeadGuard detected a problem");
  });

  it("retries a temporary email failure on the same delivery", async () => {
    const seeded = await seedMonitor("Email Retry");
    const scripted = createScriptedEmailProvider([
      {
        ok: false,
        retryable: true,
        errorType: "TIMEOUT",
        message: "SMTP timeout",
      },
      { ok: true },
    ]);
    setEmailProviderOverride(scripted);
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Ops",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    const incidentId = await openIncident(seeded);
    await dispatchPendingOutboxEvents();
    const delivery = await database.notificationDelivery.findFirstOrThrow({
      where: { incidentId },
    });
    await processDelivery(delivery.id);
    await database.notificationDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await processDelivery(delivery.id);
    const updated = await database.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(updated.status).toBe("SENT");
    expect(updated.attemptCount).toBe(2);
    expect(
      await database.notificationDelivery.count({ where: { incidentId } }),
    ).toBe(1);
  });

  it("marks a permanent email failure as FAILED", async () => {
    const seeded = await seedMonitor("Email Permanent");
    setEmailProviderOverride(
      createScriptedEmailProvider([
        {
          ok: false,
          retryable: false,
          errorType: "RECIPIENT_REJECTED",
          message: "The recipient address was rejected.",
        },
      ]),
    );
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Ops",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    const incidentId = await openIncident(seeded);
    await dispatchPendingOutboxEvents();
    const delivery = await database.notificationDelivery.findFirstOrThrow({
      where: { incidentId },
    });
    await processDelivery(delivery.id);
    const updated = await database.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(updated.status).toBe("FAILED");
    expect(updated.lastErrorType).toBe("RECIPIENT_REJECTED");
  });

  it("sends a resolved email after recovery", async () => {
    const seeded = await seedMonitor("Resolved Email");
    const inbox = createMemoryEmailProvider();
    setEmailProviderOverride(inbox);
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Ops",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    await openIncident(seeded);
    await applyCheck(
      seeded,
      checkResult({ status: "SUCCESS", httpStatus: 200 }),
    );
    await dispatchPendingOutboxEvents();
    const deliveries = await database.notificationDelivery.findMany({
      where: { organizationId: seeded.organization.id },
    });
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      await processDelivery(delivery.id);
    }
    expect(inbox.messages.map((message) => message.subject).join(" ")).toMatch(
      /Incident/,
    );
    expect(inbox.messages.map((message) => message.subject).join(" ")).toMatch(
      /Resolved/,
    );
  });

  it("classifies webhook HTTP results", async () => {
    const cases: Array<{
      status: number;
      retryable: boolean;
      ok?: boolean;
    }> = [
      { status: 200, ok: true, retryable: false },
      { status: 204, ok: true, retryable: false },
      { status: 400, retryable: false },
      { status: 401, retryable: false },
      { status: 429, retryable: true },
      { status: 500, retryable: true },
    ];
    for (const item of cases) {
      const transport: PinnedHttpTransport = async () => ({
        statusCode: item.status,
        headers: {},
      });
      const result = await sendSignedWebhook({
        url: "https://example.com/hook",
        secret: "lgwh_test",
        deliveryId: "del_1",
        event: "incident.opened",
        payload: { version: 1 },
        resolver: publicResolver,
        transport,
      });
      if (item.ok) expect(result.ok).toBe(true);
      else {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.retryable).toBe(item.retryable);
      }
    }
    const timeout: PinnedHttpTransport = async () => {
      const error = new Error("timed out");
      (error as NodeJS.ErrnoException).code = "ETIMEDOUT";
      throw error;
    };
    const timedOut = await sendSignedWebhook({
      url: "https://example.com/hook",
      secret: "lgwh_test",
      deliveryId: "del_2",
      event: "incident.opened",
      payload: { version: 1 },
      resolver: publicResolver,
      transport: timeout,
    });
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) {
      expect(timedOut.retryable).toBe(true);
      expect(timedOut.errorType).toBe("TIMEOUT");
    }
  });
});

describe("webhook signatures and SSRF", () => {
  it("signs timestamp plus body with HMAC-SHA256", () => {
    const body = JSON.stringify({ version: 1, event: "incident.opened" });
    const timestamp = "1710000000";
    const secret = "lgwh_secret";
    const left = signWebhookBody(secret, timestamp, body);
    const right = signWebhookBody(secret, timestamp, body);
    expect(webhookSignaturesMatch(left, right)).toBe(true);
    const changed = signWebhookBody(secret, timestamp, body.replace("1", "2"));
    expect(webhookSignaturesMatch(left, changed)).toBe(false);
  });

  it("blocks private webhook destinations", async () => {
    const blocked = [
      "http://127.0.0.1/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.1/hook",
      "http://192.168.1.1/hook",
      "http://[::1]/hook",
    ];
    for (const url of blocked) {
      const result = await sendSignedWebhook({
        url,
        secret: "lgwh_test",
        deliveryId: "del_ssrf",
        event: "incident.opened",
        payload: { version: 1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorType).toBe("UNSAFE_TARGET");
    }
    const rebound = await sendSignedWebhook({
      url: "https://rebind.example.com/hook",
      secret: "lgwh_test",
      deliveryId: "del_rebind",
      event: "incident.opened",
      payload: { version: 1 },
      resolver: async () => ["127.0.0.1"],
    });
    expect(rebound.ok).toBe(false);
    if (!rebound.ok) expect(rebound.errorType).toBe("UNSAFE_TARGET");
  });
});

describe("notification authorization", () => {
  it("isolates channels and deliveries across tenants", async () => {
    const tenantA = await seedMonitor("Tenant A Notify");
    const tenantB = await createTestOwner("Tenant B Notify");
    userIds.push(tenantB.user.id);
    organizationIds.push(tenantB.organization.id);
    await createEmailChannel({
      userId: tenantA.user.id,
      organizationSlug: tenantA.organization.slug,
      name: "A Ops",
      email: "a@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    const aChannels = await listNotificationChannels(
      tenantA.user.id,
      tenantA.organization.slug,
    );
    await expect(
      listNotificationChannels(tenantB.user.id, tenantA.organization.slug),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      revealWebhookSecret({
        userId: tenantB.user.id,
        organizationSlug: tenantA.organization.slug,
        channelId: aChannels[0]!.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const incidentId = await openIncident(tenantA);
    await dispatchPendingOutboxEvents();
    await expect(
      listIncidentDeliveries(
        tenantB.user.id,
        tenantA.organization.slug,
        incidentId,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets members view channels but not create them", async () => {
    const owner = await createTestOwner("Notify Member");
    const member = await createTestUser("Notify Member User");
    userIds.push(owner.user.id, member.id);
    organizationIds.push(owner.organization.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    await expect(
      listNotificationChannels(member.id, owner.organization.slug),
    ).resolves.toEqual([]);
    await expect(
      createEmailChannel({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        name: "Nope",
        email: "nope@example.com",
        notifyOnOpened: true,
        notifyOnResolved: true,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rate-limits test notifications", async () => {
    const seeded = await seedMonitor("Test Limit");
    const channel = await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Ops",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    setEmailProviderOverride(createMemoryEmailProvider());
    await sendTestNotification({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      channelId: channel.id,
    });
    await expect(
      sendTestNotification({
        userId: seeded.user.id,
        organizationSlug: seeded.organization.slug,
        channelId: channel.id,
      }),
    ).rejects.toThrow(/wait/i);
  });
});

describe("templates and validation", () => {
  it("escapes user-controlled HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).not.toContain("<script>");
  });

  it("rejects invalid emails", () => {
    expect(
      createEmailChannelSchema.safeParse({
        name: "Ops",
        email: "not-an-email",
        notifyOnOpened: true,
        notifyOnResolved: true,
      }).success,
    ).toBe(false);
    expect(
      createEmailChannelSchema.safeParse({
        name: "Ops",
        email: " ops@example.com ",
        notifyOnOpened: true,
        notifyOnResolved: true,
      }).data?.email,
    ).toBe("ops@example.com");
  });
});

describe("parallel delivery claims", () => {
  it("lets only one worker claim a delivery", async () => {
    const seeded = await seedMonitor("Claim Race");
    setEmailProviderOverride(createMemoryEmailProvider());
    await createEmailChannel({
      userId: seeded.user.id,
      organizationSlug: seeded.organization.slug,
      name: "Ops",
      email: "ops@example.com",
      notifyOnOpened: true,
      notifyOnResolved: true,
    });
    const incidentId = await openIncident(seeded);
    await dispatchPendingOutboxEvents();
    const delivery = await database.notificationDelivery.findFirstOrThrow({
      where: { incidentId },
    });
    const [first, second] = await Promise.all([
      processDelivery(delivery.id),
      processDelivery(delivery.id),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toContain("sent");
    expect(
      statuses.some(
        (status) => status === "already_complete" || status === "skipped",
      ),
    ).toBe(true);
  });
});
