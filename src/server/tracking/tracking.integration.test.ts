import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import { createWebsite } from "@/server/websites/service";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import {
  cleanupExpiredTrackingData,
  deleteVisitorTrackingData,
  enableWebsiteTracking,
  ingestBrowserEvent,
  ingestServerLead,
} from "@/server/tracking/service";
import { enableTrackingForWebsite } from "@/server/tracking/actions-service";
import { hashClickId } from "@/server/tracking/click-crypto";
import { trackerV1Source } from "@/tracking/sdk/v1-source";
import { createLogger } from "@/server/logger";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

async function trackingSite(name: string) {
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
  return { owner, website, ...enabled };
}

const visitorId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

describe("revenue attribution foundation", () => {
  it("captures gclid after consent and does not log the raw id", () => {
    expect(trackerV1Source).toContain("window.__LEADGUARD_MONITORING__");
    expect(trackerV1Source).toContain("_lg_vid");
    expect(trackerV1Source).not.toContain(
      'document.cookie = "_lg_vid=" + ids.gclid',
    );
    const lines: string[] = [];
    const original = console.info;
    console.info = ((value: string) => {
      lines.push(String(value));
    }) as typeof console.info;
    try {
      createLogger("tracking").info("tracking.attribution.created", {
        hasGclid: true,
        gclid: "SECRETCLICK",
      });
    } finally {
      console.info = original;
    }
    expect(lines.join(" ")).toContain("hasGclid");
    expect(lines.join(" ")).not.toContain("SECRETCLICK");
  });

  it("rejects a wrong origin and disabled tracking", async () => {
    const { website, siteKey } = await trackingSite("Attr Origin");
    const wrongOrigin = await ingestBrowserEvent({
      siteKey,
      originHeader: "https://evil.example",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "14141414-1414-4141-8141-141414141414",
        consent: "granted",
        visitorId,
        sessionId,
        clickIds: { gclid: "WrongOrigin" },
      },
    });
    expect(wrongOrigin.ok).toBe(false);
    await database.websiteTrackingConfig.update({
      where: { websiteId: website.id },
      data: { status: "DISABLED" },
    });
    const disabled = await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "15151515-1515-4151-8151-151515151515",
        consent: "granted",
        visitorId,
        sessionId,
        clickIds: { gclid: "DisabledClick" },
      },
    });
    expect(disabled.ok).toBe(false);
    expect(
      await database.attributionTouch.count({
        where: { websiteId: website.id },
      }),
    ).toBe(0);
  });

  it("creates an expired attribution when the token is expired", async () => {
    const { website, siteKey, serverSecret } = await trackingSite("Attr Token");
    const session = await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "16161616-1616-4161-8161-161616161616",
        consent: "granted",
        visitorId,
        sessionId,
        clickIds: { gclid: "TokenClick" },
        landingPath: "/",
        landingOrigin: "https://example.nl",
      },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    await database.attributionToken.updateMany({
      where: { websiteId: website.id },
      data: { expiresAt: new Date("2020-01-01") },
    });
    const lead = await ingestServerLead({
      secret: serverSecret,
      payload: {
        eventId: "17171717-1717-4171-8171-171717171717",
        attributionToken: session.attributionToken,
      },
    });
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;
    expect(lead.attributionStatus).toBe("EXPIRED");
  });

  it("stores both gclid and gbraid and attributes last paid touch", async () => {
    const { website, siteKey, serverSecret } = await trackingSite("Attr Multi");
    const first = await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        consent: "granted",
        visitorId,
        sessionId,
        clickIds: { gclid: "ClickA", gbraid: "BraidA" },
        landingPath: "/airco",
        landingOrigin: "https://example.nl",
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const sessionB = "33333333-3333-4333-8333-333333333333";
    await ingestBrowserEvent({
      siteKey,
      originHeader: "https://www.example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        consent: "granted",
        visitorId,
        sessionId: sessionB,
        clickIds: { gclid: "ClickB" },
        landingPath: "/airco",
        landingOrigin: "https://example.nl",
      },
    });
    const lead = await ingestServerLead({
      secret: serverSecret,
      payload: {
        eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        attributionToken: first.attributionToken,
        externalLeadId: "crm-1",
      },
    });
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;
    const stored = await database.lead.findFirstOrThrow({
      where: { websiteId: website.id },
      include: {
        attribution: { include: { primaryTouch: true, firstTouch: true } },
        outcome: true,
      },
    });
    expect(stored.attribution?.attributionStatus).toBe("ATTRIBUTED");
    expect(stored.attribution?.primaryTouch?.hasGclid).toBe(true);
    expect(stored.attribution?.firstTouchId).not.toBe(
      stored.attribution?.primaryTouchId,
    );
    expect(stored.attribution?.primaryTouch?.gclidHash).toBe(
      hashClickId("ClickB"),
    );
    expect(stored.outcome?.status).toBe("NEW");
    const retry = await ingestServerLead({
      secret: serverSecret,
      payload: {
        eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        attributionToken: first.attributionToken,
        externalLeadId: "crm-1",
      },
    });
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(
      await database.lead.count({ where: { websiteId: website.id } }),
    ).toBe(1);
  });

  it("rejects a cross-website token and monitor traffic", async () => {
    const a = await trackingSite("Attr A");
    const b = await trackingSite("Attr B");
    const session = await ingestBrowserEvent({
      siteKey: a.siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        consent: "granted",
        visitorId,
        sessionId,
        clickIds: { gclid: "OnlyA" },
        landingPath: "/",
        landingOrigin: "https://example.nl",
      },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const crossed = await ingestServerLead({
      secret: b.serverSecret,
      payload: {
        eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        attributionToken: session.attributionToken,
      },
    });
    expect(crossed.ok).toBe(false);
    const monitor = await ingestBrowserEvent({
      siteKey: a.siteKey,
      originHeader: "https://example.nl",
      monitorHeader: "1",
      payload: {
        type: "session",
        eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        consent: "granted",
        visitorId: "44444444-4444-4444-8444-444444444444",
        sessionId: "55555555-5555-4555-8555-555555555555",
        clickIds: { gclid: "MonitorClick" },
      },
    });
    expect(monitor.ok).toBe(true);
    expect(
      await database.attributionTouch.count({
        where: {
          websiteId: a.website.id,
          gclidHash: hashClickId("MonitorClick"),
        },
      }),
    ).toBe(0);
  });

  it("does not persist without granted consent and blocks members from enabling", async () => {
    const { owner, website, siteKey } = await trackingSite("Attr Consent");
    const denied = await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "99999999-9999-4999-8999-999999999999",
        consent: "unknown",
        visitorId,
        sessionId,
        clickIds: { gclid: "NoConsent" },
      },
    });
    expect(denied.ok).toBe(false);
    expect(
      await database.attributionTouch.count({
        where: { websiteId: website.id },
      }),
    ).toBe(0);
    const member = await createTestUser("Tracking Member");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    await expect(
      enableTrackingForWebsite({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cleans up expired unattributed visitors", async () => {
    const { website, siteKey } = await trackingSite("Attr Retain");
    await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "12121212-1212-4121-8121-121212121212",
        consent: "granted",
        visitorId,
        sessionId,
        clickIds: { gclid: "OldClick" },
      },
    });
    const visitor = await database.attributionVisitor.findFirstOrThrow({
      where: { websiteId: website.id },
    });
    await database.attributionVisitor.update({
      where: { id: visitor.id },
      data: { expiresAt: new Date("2020-01-01") },
    });
    await database.attributionTouch.updateMany({
      where: { visitorId: visitor.id },
      data: { expiresAt: new Date("2020-01-01") },
    });
    await cleanupExpiredTrackingData(new Date());
    expect(
      await database.attributionVisitor.count({
        where: { websiteId: website.id },
      }),
    ).toBe(0);
    await deleteVisitorTrackingData({
      organizationId: website.organizationId,
      visitorId: visitor.id,
    });
  });

  it("does not treat a missing trackLead as a lead", async () => {
    const { website, siteKey } = await trackingSite("Attr NoSubmit");
    await ingestBrowserEvent({
      siteKey,
      originHeader: "https://example.nl",
      monitorHeader: null,
      payload: {
        type: "session",
        eventId: "13131313-1313-4131-8131-131313131313",
        consent: "granted",
        visitorId,
        sessionId,
      },
    });
    expect(
      await database.lead.count({ where: { websiteId: website.id } }),
    ).toBe(0);
  });
});
