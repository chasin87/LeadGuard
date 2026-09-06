import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { createWebsite } from "@/server/websites/service";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { AuthorizationError } from "@/server/authorization/errors";
import {
  enableWebsiteTracking,
  ingestBrowserEvent,
  ingestServerLead,
} from "@/server/tracking/service";
import { applyLeadOutcomeMutation } from "@/server/leads/service";
import type { DnsResolver } from "@/server/security/ssrf";
import { createOutcomeIntegration } from "@/server/outcomes/integrations";
import { ingestParsedOutcomeEvent } from "@/server/outcomes/service";
import {
  authenticateOutcomeBearer,
  authenticateOutcomeHmac,
} from "@/server/outcomes/auth";
import { signWebhookBody } from "@/server/notifications/webhooks/signature";
import {
  createOutcomeImport,
  processOutcomeImport,
  saveOutcomeImportMapping,
} from "@/server/outcomes/import-service";
import {
  ignoreExternalOutcomeEvent,
  linkUnmatchedOutcomeEvent,
} from "@/server/outcomes/reconciliation";
import { resetRateLimitStore } from "@/server/auth/rate-limit";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

async function trackedLead(name: string, externalLeadId?: string) {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
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
      clickIds: { gclid: "OutcomeClick" },
      landingPath: "/airco",
      landingOrigin: "https://example.nl",
    },
  });
  expect(session.ok).toBe(true);
  if (!session.ok) throw new Error("session ingest failed");
  const ext = externalLeadId ?? `quote_${randomUUID().slice(0, 8)}`;
  const ingested = await ingestServerLead({
    secret: enabled.serverSecret,
    payload: {
      eventId: randomUUID(),
      attributionToken: session.attributionToken,
      externalLeadId: ext,
    },
  });
  expect(ingested.ok).toBe(true);
  if (!ingested.ok) throw new Error("lead ingest failed");
  const lead = await database.lead.findFirstOrThrow({
    where: { websiteId: website.id },
    include: { outcome: true, attribution: true },
  });
  return { owner, website, lead, externalLeadId: ext, ...enabled };
}

function at(lead: { occurredAt: Date }, offsetMs = 0) {
  return new Date(lead.occurredAt.getTime() + offsetMs);
}

async function integrationFor(
  owner: { user: { id: string }; organization: { slug: string; id: string } },
  websiteId: string,
  authMode: "BEARER" | "HMAC" = "BEARER",
) {
  return createOutcomeIntegration({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    name: "Custom CRM",
    type: authMode === "HMAC" ? "WEBHOOK" : "API",
    authMode,
    sourceSystem: "custom-crm",
    websiteIds: [websiteId],
  });
}

describe("external outcome ingestion", () => {
  it("applies WON revenue through the existing outcome service", async () => {
    const ctx = await trackedLead("Ingest Won", "quote_123");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const primaryBefore = ctx.lead.attribution?.primaryTouchId ?? null;
    const result = await ingestParsedOutcomeEvent({
      integration: {
        id: created.integration.id,
        organizationId: created.integration.organizationId,
        name: created.integration.name,
        type: created.integration.type,
        status: created.integration.status,
        authMode: created.integration.authMode,
        sourceSystem: created.integration.sourceSystem,
        credentialPrefix: created.integration.credentialPrefix,
      },
      parsed: {
        eventId: "crm-event-1",
        externalLeadId: "quote_123",
        publicLeadId: null,
        sourceRecordId: "deal_5543",
        sourceVersion: null,
        status: "WON",
        effectiveAt: at(ctx.lead, 1_000),
        revenueAmount: "4500.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(result.status).toBe("APPLIED");
    expect(result.leadId).toBe(ctx.lead.id);
    const outcome = await database.leadOutcome.findUniqueOrThrow({
      where: { leadId: ctx.lead.id },
    });
    expect(outcome.status).toBe("WON");
    expect(outcome.revenueAmountMinor).toBe(450000n);
    const event = await database.leadOutcomeEvent.findFirstOrThrow({
      where: { leadId: ctx.lead.id, source: "API" },
    });
    expect(event.actorType).toBe("INTEGRATION");
    expect(event.sourceEventId).toBe("crm-event-1");
    const attribution = await database.leadAttribution.findUniqueOrThrow({
      where: { leadId: ctx.lead.id },
    });
    expect(attribution.primaryTouchId).toBe(primaryBefore);
    expect(ctx.lead.occurredAt.getTime()).toBe(
      (
        await database.lead.findUniqueOrThrow({ where: { id: ctx.lead.id } })
      ).occurredAt.getTime(),
    );
  });

  it("is idempotent for the same sourceEventId", async () => {
    const ctx = await trackedLead("Ingest Dup");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const integration = {
      id: created.integration.id,
      organizationId: created.integration.organizationId,
      name: created.integration.name,
      type: created.integration.type,
      status: created.integration.status,
      authMode: created.integration.authMode,
      sourceSystem: created.integration.sourceSystem,
      credentialPrefix: created.integration.credentialPrefix,
    };
    const payload = {
      eventId: "same-event",
      externalLeadId: ctx.externalLeadId,
      publicLeadId: null,
      sourceRecordId: "deal-dup",
      sourceVersion: null,
      status: "WON" as const,
      effectiveAt: new Date(),
      revenueAmount: "10.00",
      revenueCurrency: "EUR",
    };
    for (let i = 0; i < 8; i += 1) {
      await ingestParsedOutcomeEvent({
        integration,
        parsed: payload,
        persist: true,
      });
    }
    expect(
      await database.externalOutcomeEvent.count({
        where: { integrationId: created.integration.id },
      }),
    ).toBe(1);
    expect(
      await database.leadOutcomeEvent.count({
        where: { leadId: ctx.lead.id, source: "API" },
      }),
    ).toBe(1);
  });

  it("keeps unmatched events and does not create leads", async () => {
    const ctx = await trackedLead("Ingest Unmatched");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const before = await database.lead.count({
      where: { organizationId: ctx.owner.organization.id },
    });
    const result = await ingestParsedOutcomeEvent({
      integration: {
        id: created.integration.id,
        organizationId: created.integration.organizationId,
        name: created.integration.name,
        type: created.integration.type,
        status: created.integration.status,
        authMode: created.integration.authMode,
        sourceSystem: created.integration.sourceSystem,
        credentialPrefix: created.integration.credentialPrefix,
      },
      parsed: {
        eventId: "missing-lead",
        externalLeadId: "does-not-exist",
        publicLeadId: null,
        sourceRecordId: "deal-missing",
        sourceVersion: null,
        status: "WON",
        effectiveAt: new Date(),
        revenueAmount: "5000.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(result.status).toBe("UNMATCHED");
    expect(
      await database.lead.count({
        where: { organizationId: ctx.owner.organization.id },
      }),
    ).toBe(before);
    expect(
      await database.externalOutcomeEvent.findFirst({
        where: { sourceEventId: "missing-lead" },
      }),
    ).toMatchObject({ status: "UNMATCHED" });
  });

  it("reuses a source record link without externalLeadId", async () => {
    const ctx = await trackedLead("Ingest Link");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const integration = {
      id: created.integration.id,
      organizationId: created.integration.organizationId,
      name: created.integration.name,
      type: created.integration.type,
      status: created.integration.status,
      authMode: created.integration.authMode,
      sourceSystem: created.integration.sourceSystem,
      credentialPrefix: created.integration.credentialPrefix,
    };
    await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "first",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "hubspot-deal-789",
        sourceVersion: null,
        status: "QUALIFIED",
        effectiveAt: at(ctx.lead, 1_000),
        revenueAmount: null,
        revenueCurrency: null,
      },
      persist: true,
    });
    const second = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "second",
        externalLeadId: null,
        publicLeadId: null,
        sourceRecordId: "hubspot-deal-789",
        sourceVersion: null,
        status: "WON",
        effectiveAt: at(ctx.lead, 2_000),
        revenueAmount: "100.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(second.status).toBe("APPLIED");
    expect(second.leadId).toBe(ctx.lead.id);
  });

  it("marks a later older event as STALE", async () => {
    const ctx = await trackedLead("Ingest Stale");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const integration = {
      id: created.integration.id,
      organizationId: created.integration.organizationId,
      name: created.integration.name,
      type: created.integration.type,
      status: created.integration.status,
      authMode: created.integration.authMode,
      sourceSystem: created.integration.sourceSystem,
      credentialPrefix: created.integration.credentialPrefix,
    };
    await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "won-late",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-stale",
        sourceVersion: null,
        status: "WON",
        effectiveAt: at(ctx.lead, 2_000),
        revenueAmount: "1.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    const stale = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "qualified-early",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-stale",
        sourceVersion: null,
        status: "QUALIFIED",
        effectiveAt: at(ctx.lead, 1_000),
        revenueAmount: null,
        revenueCurrency: null,
      },
      persist: true,
    });
    expect(stale.status).toBe("STALE");
    const outcome = await database.leadOutcome.findUniqueOrThrow({
      where: { leadId: ctx.lead.id },
    });
    expect(outcome.status).toBe("WON");
  });

  it("lets a newer external event override an older manual correction", async () => {
    const ctx = await trackedLead("Ingest Newer Ext");
    await applyLeadOutcomeMutation({
      userId: ctx.owner.user.id,
      organizationSlug: ctx.owner.organization.slug,
      leadId: ctx.lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "QUALIFIED",
      effectiveAt: at(ctx.lead, 1_000),
    });
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const result = await ingestParsedOutcomeEvent({
      integration: {
        id: created.integration.id,
        organizationId: created.integration.organizationId,
        name: created.integration.name,
        type: created.integration.type,
        status: created.integration.status,
        authMode: created.integration.authMode,
        sourceSystem: created.integration.sourceSystem,
        credentialPrefix: created.integration.credentialPrefix,
      },
      parsed: {
        eventId: "ext-won",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: ctx.lead.publicLeadId,
        sourceRecordId: "deal-newer",
        sourceVersion: null,
        status: "WON",
        effectiveAt: at(ctx.lead, 2_000),
        revenueAmount: "20.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(result.status).toBe("APPLIED");
    expect(
      (
        await database.leadOutcome.findUniqueOrThrow({
          where: { leadId: ctx.lead.id },
        })
      ).status,
    ).toBe("WON");
  });

  it("keeps a newer manual correction when an older external event arrives", async () => {
    const ctx = await trackedLead("Ingest Manual Newer");
    await applyLeadOutcomeMutation({
      userId: ctx.owner.user.id,
      organizationSlug: ctx.owner.organization.slug,
      leadId: ctx.lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "10.00", currency: "EUR" },
      effectiveAt: at(ctx.lead, 2_000),
    });
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const result = await ingestParsedOutcomeEvent({
      integration: {
        id: created.integration.id,
        organizationId: created.integration.organizationId,
        name: created.integration.name,
        type: created.integration.type,
        status: created.integration.status,
        authMode: created.integration.authMode,
        sourceSystem: created.integration.sourceSystem,
        credentialPrefix: created.integration.credentialPrefix,
      },
      parsed: {
        eventId: "old-crm",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-old",
        sourceVersion: null,
        status: "QUALIFIED",
        effectiveAt: at(ctx.lead, 1_000),
        revenueAmount: null,
        revenueCurrency: null,
      },
      persist: true,
    });
    expect(result.status).toBe("STALE");
  });

  it("rejects LOST with revenue and allows WON without revenue or zero", async () => {
    const ctx = await trackedLead("Ingest Revenue Rules");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const integration = {
      id: created.integration.id,
      organizationId: created.integration.organizationId,
      name: created.integration.name,
      type: created.integration.type,
      status: created.integration.status,
      authMode: created.integration.authMode,
      sourceSystem: created.integration.sourceSystem,
      credentialPrefix: created.integration.credentialPrefix,
    };
    const lost = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "lost-rev",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-lost",
        sourceVersion: null,
        status: "LOST",
        effectiveAt: new Date(),
        revenueAmount: "10.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(lost.status).toBe("REJECTED");
    const won = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "won-empty",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-won",
        sourceVersion: null,
        status: "WON",
        effectiveAt: at(ctx.lead, 1_000),
        revenueAmount: null,
        revenueCurrency: null,
      },
      persist: true,
    });
    expect(won.status).toBe("APPLIED");
    const zero = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "won-zero",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-zero",
        sourceVersion: null,
        status: "WON",
        effectiveAt: at(ctx.lead, 2_000),
        revenueAmount: "0.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(zero.status).toBe("APPLIED");
    const negative = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "won-neg",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-neg",
        sourceVersion: null,
        status: "WON",
        effectiveAt: new Date(),
        revenueAmount: "-1.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(negative.status).toBe("REJECTED");
  });

  it("allows trusted integrations to correct WON to LOST", async () => {
    const ctx = await trackedLead("Ingest Terminal");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const integration = {
      id: created.integration.id,
      organizationId: created.integration.organizationId,
      name: created.integration.name,
      type: created.integration.type,
      status: created.integration.status,
      authMode: created.integration.authMode,
      sourceSystem: created.integration.sourceSystem,
      credentialPrefix: created.integration.credentialPrefix,
    };
    await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "to-won",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-term",
        sourceVersion: 1,
        status: "WON",
        effectiveAt: at(ctx.lead, 1_000),
        revenueAmount: "5.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    const lost = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "to-lost",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: null,
        sourceRecordId: "deal-term",
        sourceVersion: 2,
        status: "LOST",
        effectiveAt: at(ctx.lead, 2_000),
        revenueAmount: null,
        revenueCurrency: null,
      },
      persist: true,
    });
    expect(lost.status).toBe("APPLIED");
    expect(
      (
        await database.leadOutcomeEvent.findFirstOrThrow({
          where: { leadId: ctx.lead.id, afterStatus: "LOST" },
        })
      ).actorType,
    ).toBe("INTEGRATION");
  });

  it("authenticates bearer credentials and rejects the rest", async () => {
    const ctx = await trackedLead("Ingest Auth");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const ok = await authenticateOutcomeBearer(`Bearer ${created.credential}`);
    expect(ok.ok).toBe(true);
    const bad = await authenticateOutcomeBearer("Bearer lgoi_deadbeef");
    expect(bad.ok).toBe(false);
    const other = await createTestOwner("Other Auth");
    userIds.push(other.user.id);
    organizationIds.push(other.organization.id);
    const otherWebsite = await createWebsite(
      {
        userId: other.user.id,
        organizationSlug: other.organization.slug,
        name: "Other",
        url: "https://example.com",
      },
      { resolver: publicResolver },
    );
    const otherInt = await integrationFor(other, otherWebsite.id);
    const cross = await ingestParsedOutcomeEvent({
      integration: {
        id: otherInt.integration.id,
        organizationId: otherInt.integration.organizationId,
        name: otherInt.integration.name,
        type: otherInt.integration.type,
        status: otherInt.integration.status,
        authMode: otherInt.integration.authMode,
        sourceSystem: otherInt.integration.sourceSystem,
        credentialPrefix: otherInt.integration.credentialPrefix,
      },
      parsed: {
        eventId: "cross",
        externalLeadId: ctx.externalLeadId,
        publicLeadId: ctx.lead.publicLeadId,
        sourceRecordId: null,
        sourceVersion: null,
        status: "WON",
        effectiveAt: new Date(),
        revenueAmount: null,
        revenueCurrency: null,
      },
      persist: true,
    });
    expect(cross.status).toBe("UNMATCHED");
  });

  it("verifies HMAC signatures and the replay window", async () => {
    const ctx = await trackedLead("Ingest Hmac");
    const created = await integrationFor(ctx.owner, ctx.website.id, "HMAC");
    const body = `{"eventId":"hmac-1","status":"QUALIFIED","effectiveAt":"${new Date().toISOString()}","externalLeadId":"${ctx.externalLeadId}"}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhookBody(created.signingSecret!, timestamp, body);
    const valid = await authenticateOutcomeHmac({
      integrationId: created.integration.id,
      timestampHeader: timestamp,
      signatureHeader: signature,
      rawBody: body,
    });
    expect(valid.ok).toBe(true);
    const wrong = await authenticateOutcomeHmac({
      integrationId: created.integration.id,
      timestampHeader: timestamp,
      signatureHeader: `sha256=${createHmac("sha256", "nope").update("x").digest("hex")}`,
      rawBody: body,
    });
    expect(wrong.ok).toBe(false);
    const expired = await authenticateOutcomeHmac({
      integrationId: created.integration.id,
      timestampHeader: String(Math.floor(Date.now() / 1000) - 20 * 60),
      signatureHeader: signature,
      rawBody: body,
    });
    expect(expired.ok).toBe(false);
    const future = await authenticateOutcomeHmac({
      integrationId: created.integration.id,
      timestampHeader: String(Math.floor(Date.now() / 1000) + 20 * 60),
      signatureHeader: signature,
      rawBody: body,
    });
    expect(future.ok).toBe(false);
    const tamper = await authenticateOutcomeHmac({
      integrationId: created.integration.id,
      timestampHeader: timestamp,
      signatureHeader: signature,
      rawBody: `${body} `,
    });
    expect(tamper.ok).toBe(false);
  });

  it("lets OWNER link an unmatched event and blocks MEMBER", async () => {
    const ctx = await trackedLead("Ingest Recon");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const integration = {
      id: created.integration.id,
      organizationId: created.integration.organizationId,
      name: created.integration.name,
      type: created.integration.type,
      status: created.integration.status,
      authMode: created.integration.authMode,
      sourceSystem: created.integration.sourceSystem,
      credentialPrefix: created.integration.credentialPrefix,
    };
    const unmatched = await ingestParsedOutcomeEvent({
      integration,
      parsed: {
        eventId: "recon-1",
        externalLeadId: null,
        publicLeadId: null,
        sourceRecordId: "deal-recon",
        sourceVersion: null,
        status: "WON",
        effectiveAt: new Date(),
        revenueAmount: "3.00",
        revenueCurrency: "EUR",
      },
      persist: true,
    });
    expect(unmatched.status).toBe("UNMATCHED");
    const member = await createTestUser("Recon Member");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: ctx.owner.organization.id,
        role: "MEMBER",
      },
    });
    await expect(
      linkUnmatchedOutcomeEvent({
        userId: member.id,
        organizationSlug: ctx.owner.organization.slug,
        eventId: unmatched.externalEventId!,
        publicLeadId: ctx.lead.publicLeadId,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      ignoreExternalOutcomeEvent({
        userId: member.id,
        organizationSlug: ctx.owner.organization.slug,
        eventId: unmatched.externalEventId!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const linked = await linkUnmatchedOutcomeEvent({
      userId: ctx.owner.user.id,
      organizationSlug: ctx.owner.organization.slug,
      eventId: unmatched.externalEventId!,
      publicLeadId: ctx.lead.publicLeadId,
    });
    expect(linked.leadId).toBe(ctx.lead.id);
    expect(
      (
        await database.leadOutcome.findUniqueOrThrow({
          where: { leadId: ctx.lead.id },
        })
      ).status,
    ).toBe("WON");
  });

  it("imports a CSV without storing unmapped PII columns", async () => {
    const ctx = await trackedLead("Ingest Csv", "quote_1");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const csv = [
      "externalLeadId,status,revenue,currency,email,phone,name",
      "quote_1,WON,4500.00,EUR,a@b.c,+316,Alice",
      "quote_2,LOST,,,b@c.d,+317,Bob",
    ].join("\n");
    const uploaded = await createOutcomeImport({
      userId: ctx.owner.user.id,
      organizationSlug: ctx.owner.organization.slug,
      integrationId: created.integration.id,
      fileName: "outcomes.csv",
      body: Buffer.from(csv, "utf8"),
    });
    await saveOutcomeImportMapping({
      userId: ctx.owner.user.id,
      organizationSlug: ctx.owner.organization.slug,
      importId: uploaded.importRecord.id,
      mapping: {
        columns: {
          externalLeadId: "externalLeadId",
          status: "status",
          revenueAmount: "revenue",
          revenueCurrency: "currency",
        },
        statusMap: {},
        defaultCurrency: null,
        effectiveAtPolicy: "import_timestamp",
      },
    });
    await processOutcomeImport(uploaded.importRecord.id);
    const finished = await database.outcomeImport.findUniqueOrThrow({
      where: { id: uploaded.importRecord.id },
    });
    expect(finished.appliedRows).toBe(1);
    expect(finished.unmatchedRows).toBe(1);
    expect(finished.mappingJson).not.toContain("Alice");
    expect(
      JSON.stringify(
        await database.outcomeImportRow.findMany({
          where: { importId: finished.id },
        }),
      ),
    ).not.toContain("a@b.c");
    await processOutcomeImport(uploaded.importRecord.id);
    expect(
      await database.leadOutcomeEvent.count({
        where: { leadId: ctx.lead.id, source: "CSV_IMPORT" },
      }),
    ).toBe(1);
  });

  it("rejects an oversized import file", async () => {
    const ctx = await trackedLead("Ingest Big");
    const created = await integrationFor(ctx.owner, ctx.website.id);
    const config = getOutcomeIngestionConfig();
    await expect(
      createOutcomeImport({
        userId: ctx.owner.user.id,
        organizationSlug: ctx.owner.organization.slug,
        integrationId: created.integration.id,
        fileName: "huge.csv",
        body: Buffer.alloc(config.importMaxFileBytes + 1),
      }),
    ).rejects.toThrow(/10 MB/);
  });
});

describe("outcome rate limit helper", () => {
  it("limits repeated keys", () => {
    resetRateLimitStore();
    const key = `test-${randomUUID()}`;
    expect(consumeRateLimit(key, 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit(key, 2, 60_000).ok).toBe(true);
    expect(consumeRateLimit(key, 2, 60_000).ok).toBe(false);
  });
});
