import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { createWebsite } from "@/server/websites/service";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { AuthorizationError } from "@/server/authorization/errors";
import {
  completeGoogleAdsOAuth,
  startGoogleAdsOAuth,
} from "@/server/google-ads/oauth";
import { discoverGoogleAdsAccounts } from "@/server/google-ads/service";
import { resetFakeGoogleAdsWorld } from "@/server/google-ads/fake-provider";
import {
  activateConversionFeedback,
  listConversionActionsForCustomer,
  saveConversionFeedbackConfig,
} from "@/server/google-ads/conversion-config";
import {
  planGoogleConversionExport,
  pollGoogleConversionExportStatus,
  submitGoogleConversionExport,
} from "@/server/google-ads/conversion-export";
import {
  getFakeDataManagerWorld,
  resetFakeDataManagerWorld,
} from "@/server/google-data-manager/fake";
import {
  cleanupExpiredTrackingData,
  deleteLeadTrackingData,
  enableWebsiteTracking,
  ingestBrowserEvent,
  ingestServerLead,
} from "@/server/tracking/service";
import { applyLeadOutcomeMutation } from "@/server/leads/service";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

beforeEach(() => {
  resetFakeGoogleAdsWorld();
  resetFakeDataManagerWorld({ mode: "PROCESSING_THEN_SUCCESS" });
});

async function connect(
  name: string,
  code = "fake-google-ads-datamanager-code",
) {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
  const url = await startGoogleAdsOAuth({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    intent: code.includes("datamanager") ? "data_manager" : "connect",
  });
  const state = new URL(url, "http://localhost:3000").searchParams.get(
    "state",
  )!;
  await completeGoogleAdsOAuth({
    userId: owner.user.id,
    code,
    state,
  });
  await discoverGoogleAdsAccounts({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
  });
  return owner;
}

async function websiteWithTracking(
  owner: Awaited<ReturnType<typeof connect>>,
  clickIds:
    | string
    | { gclid?: string; gbraid?: string; wbraid?: string } = "ClickForWon",
) {
  const ids = typeof clickIds === "string" ? { gclid: clickIds } : clickIds;
  const website = await createWebsite(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      name: "Example NL",
      url: "https://example.nl",
    },
    { resolver: publicResolver },
  );
  const enabled = await enableWebsiteTracking({
    organizationId: owner.organization.id,
    websiteId: website.id,
  });
  const session = await ingestBrowserEvent({
    siteKey: enabled.siteKey,
    originHeader: "https://example.nl",
    monitorHeader: null,
    payload: {
      type: "session",
      eventId: randomUUID(),
      consent: "granted",
      visitorId: randomUUID(),
      sessionId: randomUUID(),
      clickIds: ids,
      landingPath: "/airco",
      landingOrigin: "https://example.nl",
    },
  });
  if (!session.ok) throw new Error("session failed");
  const ingested = await ingestServerLead({
    secret: enabled.serverSecret,
    payload: {
      eventId: randomUUID(),
      attributionToken: session.attributionToken,
      externalLeadId: `ext-${randomUUID()}`,
    },
  });
  if (!ingested.ok) throw new Error("lead failed");
  const lead = await database.lead.findFirstOrThrow({
    where: { websiteId: website.id },
    include: {
      outcome: true,
      attribution: { include: { primaryTouch: true } },
    },
  });
  return { website, lead, enabled };
}

async function activateFeedback(
  owner: Awaited<ReturnType<typeof connect>>,
  websiteId: string,
  valuePolicy:
    | "REVENUE_IF_AVAILABLE"
    | "REQUIRE_REVENUE"
    | "NO_VALUE" = "REVENUE_IF_AVAILABLE",
) {
  const customer = await database.googleAdsCustomer.findFirstOrThrow({
    where: {
      organizationId: owner.organization.id,
      googleCustomerId: "2222222222",
    },
  });
  await listConversionActionsForCustomer({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    googleAdsCustomerId: customer.id,
  });
  const config = await saveConversionFeedbackConfig({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    websiteId,
    googleAdsCustomerId: customer.id,
    conversionActionId: "9876543210",
    eventSource: "OTHER",
    valuePolicy,
  });
  await activateConversionFeedback({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    configId: config.id,
    confirmed: true,
  });
  return config;
}

describe("Google Ads conversion feedback", () => {
  it("requires Data Manager reconnect and keeps Ads history", async () => {
    const owner = await connect("Ads Only Scope", "fake-google-ads-code");
    const connection = await database.googleAdsConnection.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(connection.dataManagerStatus).toBe("NOT_CONFIGURED");
    expect(connection.grantedScopes).not.toContain("datamanager");
    const url = await startGoogleAdsOAuth({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      intent: "data_manager",
    });
    expect(url).toContain("intent=data_manager");
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    )!;
    await completeGoogleAdsOAuth({
      userId: owner.user.id,
      code: "fake-google-ads-datamanager-code",
      state,
    });
    const upgraded = await database.googleAdsConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(upgraded.id).toBe(connection.id);
    expect(upgraded.dataManagerStatus).toBe("READY");
    expect(upgraded.grantedScopes).toContain("datamanager");
  });

  it("keeps Ads monitoring when Data Manager permission is denied", async () => {
    const owner = await connect("Deny DM", "fake-google-ads-code");
    const url = await startGoogleAdsOAuth({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      intent: "data_manager",
    });
    const state = new URL(url, "http://localhost:3000").searchParams.get(
      "state",
    )!;
    await completeGoogleAdsOAuth({
      userId: owner.user.id,
      code: "fake-google-ads-deny-datamanager-code",
      state,
    });
    const connection = await database.googleAdsConnection.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(connection.status).toBe("CONNECTED");
    expect(connection.dataManagerStatus).toBe("REAUTH_REQUIRED");
  });

  it("does not let a MEMBER activate conversion feedback", async () => {
    const owner = await connect("Member Config");
    const member = await createTestUser("Member CF");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    const { website } = await websiteWithTracking(owner);
    const customer = await database.googleAdsCustomer.findFirstOrThrow({
      where: {
        organizationId: owner.organization.id,
        googleCustomerId: "2222222222",
      },
    });
    await listConversionActionsForCustomer({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleAdsCustomerId: customer.id,
    });
    await expect(
      saveConversionFeedbackConfig({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
        googleAdsCustomerId: customer.id,
        conversionActionId: "9876543210",
        eventSource: "OTHER",
        valuePolicy: "REVENUE_IF_AVAILABLE",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("exports exactly one WON Google lead with revenue and wonAt", async () => {
    const owner = await connect("Won Export");
    const { website, lead } = await websiteWithTracking(owner, "SecretGclid");
    await activateFeedback(owner, website.id);
    const wonAt = new Date(lead.occurredAt.getTime() + 60_000);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
      effectiveAt: wonAt,
    });
    for (let i = 0; i < 10; i += 1) {
      await planGoogleConversionExport({
        leadId: lead.id,
        organizationId: owner.organization.id,
      });
    }
    const exports = await database.googleAdsConversionExport.findMany({
      where: { leadId: lead.id },
    });
    expect(exports).toHaveLength(1);
    expect(exports[0]?.conversionTimestamp.toISOString()).toBe(
      wonAt.toISOString(),
    );
    await submitGoogleConversionExport({ exportId: exports[0]!.id });
    await pollGoogleConversionExportStatus({ exportId: exports[0]!.id });
    await pollGoogleConversionExportStatus({ exportId: exports[0]!.id });
    const done = await database.googleAdsConversionExport.findUniqueOrThrow({
      where: { id: exports[0]!.id },
    });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.valueAmountMinor).toBe(450000n);
    expect(getFakeDataManagerWorld().ingested).toHaveLength(1);
    const payload = getFakeDataManagerWorld().ingested[0]!.input.event;
    expect(payload.conversionValue).toBe(4500);
    expect(payload.adIdentifiers.gclid).toBe("SecretGclid");
    expect(payload.eventTimestamp).toBe(wonAt.toISOString());
    expect(payload.eventTimestamp).not.toBe(lead.createdAt.toISOString());
    expect(payload.eventTimestamp).not.toBe(lead.occurredAt.toISOString());
    const storedTouch = await database.attributionTouch.findFirstOrThrow({
      where: { id: lead.attribution!.primaryTouchId! },
    });
    expect(storedTouch.encryptedGclid).not.toBe("SecretGclid");
    expect(storedTouch.hasGclid).toBe(true);
  });

  it("does not export organic, qualified or lost leads", async () => {
    const owner = await connect("Organic Skip");
    const website = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Organic NL",
        url: "https://example.com",
      },
      { resolver: publicResolver },
    );
    await activateFeedback(owner, website.id);
    const enabled = await enableWebsiteTracking({
      organizationId: owner.organization.id,
      websiteId: website.id,
    });
    const session = await ingestBrowserEvent({
      siteKey: enabled.siteKey,
      originHeader: "https://example.com",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: randomUUID(),
        consent: "granted",
        visitorId: randomUUID(),
        sessionId: randomUUID(),
        landingPath: "/",
        landingOrigin: "https://example.com",
      },
    });
    if (!session.ok) throw new Error("session");
    const ingested = await ingestServerLead({
      secret: enabled.serverSecret,
      payload: {
        eventId: randomUUID(),
        attributionToken: session.attributionToken,
        externalLeadId: `org-${randomUUID()}`,
      },
    });
    if (!ingested.ok) throw new Error("lead");
    const lead = await database.lead.findFirstOrThrow({
      where: { websiteId: website.id },
      include: { outcome: true },
    });
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    expect(
      await database.googleAdsConversionExport.count({
        where: { leadId: lead.id },
      }),
    ).toBe(0);
  });

  it("updates pending revenue and cancels WON to LOST before submit", async () => {
    const owner = await connect("Pending Changes");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 2,
      status: "WON",
      revenue: { amount: "4750.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const pending = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(pending.valueAmountMinor).toBe(475000n);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 3,
      status: "LOST",
      confirmTerminalTransition: true,
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const cancelled = await database.googleAdsConversionExport.findFirstOrThrow(
      {
        where: { leadId: lead.id },
      },
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(getFakeDataManagerWorld().ingested).toHaveLength(0);
  });

  it("marks OUT_OF_SYNC after success instead of a second conversion", async () => {
    const owner = await connect("Out Of Sync");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      mutationId: randomUUID(),
      leadId: lead.id,
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    await pollGoogleConversionExportStatus({ exportId: row.id });
    await pollGoogleConversionExportStatus({ exportId: row.id });
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      mutationId: randomUUID(),
      leadId: lead.id,
      expectedVersion: 2,
      status: "LOST",
      revenue: null,
      confirmTerminalTransition: true,
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const updated = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(updated.status).toBe("OUT_OF_SYNC");
    expect(getFakeDataManagerWorld().ingested).toHaveLength(1);
  });

  it("retries the same transaction ID after an ambiguous network accept", async () => {
    resetFakeDataManagerWorld({ mode: "NETWORK_AFTER_ACCEPT" });
    const owner = await connect("Ambiguous Net");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      mutationId: randomUUID(),
      leadId: lead.id,
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    const first = await database.googleAdsConversionExport.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(first.status).toBe("RETRYABLE_ERROR");
    expect(first.transactionId).toBe(row.transactionId);
    await database.googleAdsConversionExport.update({
      where: { id: row.id },
      data: { status: "READY", nextAttemptAt: new Date() },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    const second = await database.googleAdsConversionExport.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(second.transactionId).toBe(row.transactionId);
    expect(second.dataManagerRequestId).toBeTruthy();
    expect(getFakeDataManagerWorld().ingested).toHaveLength(1);
  });

  it("rejects invalid GCLIDs without infinite retry", async () => {
    resetFakeDataManagerWorld({ mode: "INVALID_GCLID" });
    const owner = await connect("Invalid Click");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      mutationId: randomUUID(),
      leadId: lead.id,
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    await pollGoogleConversionExportStatus({ exportId: row.id });
    const done = await database.googleAdsConversionExport.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(done.status).toBe("REJECTED");
    expect(done.lastErrorCode).toBe("PROCESSING_ERROR_REASON_INVALID_GCLID");
  });

  it("keeps lead-linked attribution touches through anonymous cleanup", async () => {
    const owner = await connect("Retention");
    const { lead } = await websiteWithTracking(owner);
    await database.attributionTouch.update({
      where: { id: lead.attribution!.primaryTouchId! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await cleanupExpiredTrackingData(new Date());
    const touch = await database.attributionTouch.findUnique({
      where: { id: lead.attribution!.primaryTouchId! },
    });
    expect(touch).not.toBeNull();
  });

  it("cancels pending export after privacy deletion", async () => {
    const owner = await connect("Privacy");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      mutationId: randomUUID(),
      leadId: lead.id,
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await deleteLeadTrackingData({
      organizationId: owner.organization.id,
      leadId: lead.id,
    });
    expect(getFakeDataManagerWorld().ingested).toHaveLength(0);
    expect(
      await database.googleAdsConversionExport.count({
        where: { leadId: lead.id },
      }),
    ).toBe(0);
  });

  it("isolates conversion config and exports across tenants", async () => {
    const ownerA = await connect("Tenant A");
    const ownerB = await connect("Tenant B");
    const { website, lead } = await websiteWithTracking(ownerA);
    await activateFeedback(ownerA, website.id);
    await applyLeadOutcomeMutation({
      userId: ownerA.user.id,
      organizationSlug: ownerA.organization.slug,
      mutationId: randomUUID(),
      leadId: lead.id,
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: ownerA.organization.id,
    });
    const exportA = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await expect(
      activateConversionFeedback({
        userId: ownerB.user.id,
        organizationSlug: ownerB.organization.slug,
        configId: (
          await database.googleAdsConversionFeedbackConfig.findFirstOrThrow({
            where: { organizationId: ownerA.organization.id },
          })
        ).id,
        confirmed: true,
      }),
    ).rejects.toBeTruthy();
    expect(
      await database.googleAdsConversionExport.findFirst({
        where: { id: exportA.id, organizationId: ownerB.organization.id },
      }),
    ).toBeNull();
  });

  it("sends all captured identifiers and omits value for NO_VALUE", async () => {
    const owner = await connect("Multi Ids");
    const { website, lead } = await websiteWithTracking(owner, {
      gclid: "ClickAll",
      gbraid: "BraidAll",
      wbraid: "WbraidAll",
    });
    await activateFeedback(owner, website.id, "NO_VALUE");
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(row.identifierTypes).toBe("GCLID,GBRAID,WBRAID");
    expect(row.valueAmountMinor).toBeNull();
    await submitGoogleConversionExport({ exportId: row.id });
    const payload = getFakeDataManagerWorld().ingested[0]!.input.event;
    expect(payload.adIdentifiers).toEqual({
      gclid: "ClickAll",
      gbraid: "BraidAll",
      wbraid: "WbraidAll",
    });
    expect(payload.conversionValue).toBeUndefined();
    expect(payload.currency).toBeUndefined();
  });

  it("blocks REQUIRE_REVENUE until revenue exists", async () => {
    const owner = await connect("Require Revenue");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id, "REQUIRE_REVENUE");
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const blocked = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blockReason).toBe("NO_REVENUE");
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 2,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const ready = await database.googleAdsConversionExport.findUniqueOrThrow({
      where: { id: blocked.id },
    });
    expect(ready.status).toBe("READY");
    expect(ready.valueAmountMinor).toBe(1000n);
  });

  it("does not ingest twice after a request ID is stored", async () => {
    resetFakeDataManagerWorld({ mode: "SUCCESS" });
    const owner = await connect("Request Id Once");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    await submitGoogleConversionExport({ exportId: row.id });
    expect(getFakeDataManagerWorld().ingested).toHaveLength(1);
  });

  it("serializes one ingest under concurrent submit", async () => {
    resetFakeDataManagerWorld({ mode: "SUCCESS" });
    const owner = await connect("Concurrent Submit");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await Promise.all([
      submitGoogleConversionExport({ exportId: row.id }),
      submitGoogleConversionExport({ exportId: row.id }),
    ]);
    expect(getFakeDataManagerWorld().ingested).toHaveLength(1);
  });

  it("marks config NEEDS_ACTION on account mismatch", async () => {
    resetFakeDataManagerWorld({ mode: "ACCOUNT_MISMATCH" });
    const owner = await connect("Mismatch");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    await pollGoogleConversionExportStatus({ exportId: row.id });
    const rejected = await database.googleAdsConversionExport.findUniqueOrThrow(
      {
        where: { id: row.id },
      },
    );
    expect(rejected.status).toBe("REJECTED");
    const config =
      await database.googleAdsConversionFeedbackConfig.findUniqueOrThrow({
        where: { id: row.configId },
      });
    expect(config.status).toBe("NEEDS_ACTION");
  });

  it("treats unexpected PARTIAL_SUCCESS as needs review", async () => {
    resetFakeDataManagerWorld({ mode: "PARTIAL_SUCCESS" });
    const owner = await connect("Partial");
    const { website, lead } = await websiteWithTracking(owner);
    await activateFeedback(owner, website.id);
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
    });
    await planGoogleConversionExport({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    const row = await database.googleAdsConversionExport.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    await submitGoogleConversionExport({ exportId: row.id });
    await pollGoogleConversionExportStatus({ exportId: row.id });
    const reviewed = await database.googleAdsConversionExport.findUniqueOrThrow(
      {
        where: { id: row.id },
      },
    );
    expect(reviewed.status).toBe("NEEDS_REVIEW");
  });
});
