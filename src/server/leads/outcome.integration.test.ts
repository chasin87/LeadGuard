import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { createWebsite } from "@/server/websites/service";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import {
  AuthorizationError,
  OutcomeVersionConflictError,
} from "@/server/authorization/errors";
import {
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

async function trackedLead(name: string) {
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
      visitorId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      clickIds: { gclid: "OutcomeClick" },
      landingPath: "/airco",
      landingOrigin: "https://example.nl",
    },
  });
  expect(session.ok).toBe(true);
  if (!session.ok) throw new Error("session ingest failed");
  const ingested = await ingestServerLead({
    secret: enabled.serverSecret,
    payload: {
      eventId: randomUUID(),
      attributionToken: session.attributionToken,
      externalLeadId: `ext-${randomUUID()}`,
    },
  });
  expect(ingested.ok).toBe(true);
  if (!ingested.ok) throw new Error("lead ingest failed");
  const lead = await database.lead.findFirstOrThrow({
    where: { websiteId: website.id },
    include: { outcome: true, attribution: true },
  });
  return { owner, website, lead, ...enabled };
}

describe("lead revenue data layer", () => {
  it("creates Lead, attribution and NEW outcome together", async () => {
    const { lead } = await trackedLead("Outcome Create");
    expect(lead.outcome?.status).toBe("NEW");
    expect(lead.outcome?.version).toBe(1);
    expect(lead.outcome?.revenueAmountMinor).toBeNull();
    expect(
      await database.leadOutcomeEvent.count({
        where: { leadId: lead.id, changeType: "CREATED" },
      }),
    ).toBe(1);
  });

  it("marks WON with revenue atomically and keeps attribution stable", async () => {
    const { owner, lead } = await trackedLead("Outcome Won");
    const primaryBefore = lead.attribution?.primaryTouchId ?? null;
    const result = await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    expect(result.outcome.status).toBe("WON");
    expect(result.outcome.revenueAmountMinor).toBe(450000n);
    expect(result.outcome.version).toBe(2);
    const reloaded = await database.lead.findFirstOrThrow({
      where: { id: lead.id },
      include: { attribution: true, outcome: true },
    });
    expect(reloaded.attribution?.primaryTouchId).toBe(primaryBefore);
    expect(reloaded.outcome?.revenueCurrencyCode).toBe("EUR");
  });

  it("clears current revenue on WON to LOST and does not restore it", async () => {
    const { owner, lead } = await trackedLead("Outcome Lost");
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "eur" },
    });
    const lost = await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 2,
      status: "LOST",
      confirmTerminalTransition: true,
    });
    expect(lost.outcome.status).toBe("LOST");
    expect(lost.outcome.revenueAmountMinor).toBeNull();
    const event = await database.leadOutcomeEvent.findFirstOrThrow({
      where: { leadId: lead.id, afterStatus: "LOST" },
    });
    expect(event.beforeRevenueAmountMinor).toBe(450000n);
    const rewon = await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 3,
      status: "WON",
      confirmTerminalTransition: true,
    });
    expect(rewon.outcome.revenueAmountMinor).toBeNull();
  });

  it("is idempotent on mutationId and conflicts on stale version", async () => {
    const { owner, lead } = await trackedLead("Outcome Concurrency");
    const mutationId = randomUUID();
    const first = await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId,
      expectedVersion: 1,
      status: "QUALIFIED",
    });
    const retry = await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId,
      expectedVersion: 1,
      status: "QUALIFIED",
    });
    expect(first.outcome.version).toBe(2);
    expect(retry.duplicate).toBe(true);
    expect(
      await database.leadOutcomeEvent.count({ where: { leadId: lead.id } }),
    ).toBe(2);
    await expect(
      applyLeadOutcomeMutation({
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        leadId: lead.id,
        mutationId: randomUUID(),
        expectedVersion: 1,
        status: "WON",
      }),
    ).rejects.toBeInstanceOf(OutcomeVersionConflictError);
  });

  it("blocks MEMBER edits and cross-tenant access", async () => {
    const { owner, lead } = await trackedLead("Outcome Auth");
    const member = await createTestUser("Outcome Member");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    await expect(
      applyLeadOutcomeMutation({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        leadId: lead.id,
        mutationId: randomUUID(),
        expectedVersion: 1,
        status: "WON",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const other = await createTestOwner("Outcome Other");
    userIds.push(other.user.id);
    organizationIds.push(other.organization.id);
    await expect(
      applyLeadOutcomeMutation({
        userId: other.user.id,
        organizationSlug: other.organization.slug,
        leadId: lead.id,
        mutationId: randomUUID(),
        expectedVersion: 1,
        status: "WON",
      }),
    ).rejects.toThrow();
  });

  it("does not let a later click rewrite a WON lead attribution", async () => {
    const { owner, website, lead, siteKey } =
      await trackedLead("Outcome Touch");
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
    });
    const before = await database.leadAttribution.findUniqueOrThrow({
      where: { leadId: lead.id },
    });
    await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: randomUUID(),
        consent: "granted",
        visitorId: "11111111-1111-4111-8111-111111111111",
        sessionId: "33333333-3333-4333-8333-333333333333",
        clickIds: { gclid: "LaterClick" },
        landingPath: "/",
        landingOrigin: "https://example.nl",
      },
    });
    const after = await database.leadAttribution.findUniqueOrThrow({
      where: { leadId: lead.id },
    });
    expect(after.primaryTouchId).toBe(before.primaryTouchId);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    void website;
  });
});
