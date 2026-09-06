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
import {
  discoverGoogleAdsAccounts,
  selectGoogleAdsCustomers,
} from "@/server/google-ads/service";
import { resetFakeGoogleAdsWorld } from "@/server/google-ads/fake-provider";
import {
  enableGoogleAdsAnalytics,
  getAnalyticsSetupOverview,
} from "@/server/google-ads/analytics-config";
import { executeGoogleAdsAnalyticsSync } from "@/server/google-ads/analytics-sync";
import {
  ensureLeadClickResolution,
  executeGoogleAdsClickResolution,
} from "@/server/google-ads/click-resolution";
import {
  enableWebsiteTracking,
  ingestBrowserEvent,
  ingestServerLead,
} from "@/server/tracking/service";
import { applyLeadOutcomeMutation } from "@/server/leads/service";
import { getRevenueAnalyticsDashboard } from "@/server/revenue-analytics/service";
import { todayInTimeZone } from "@/server/revenue-analytics/dates";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

beforeEach(() => {
  resetFakeGoogleAdsWorld();
});

async function connect(name: string, code = "fake-google-ads-code") {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
  const url = await startGoogleAdsOAuth({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    intent: "connect",
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
  await selectGoogleAdsCustomers({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    googleCustomerIds: ["2222222222"],
  });
  return owner;
}

async function trackedLead(
  owner: Awaited<ReturnType<typeof connect>>,
  clickIds: { gclid?: string; gbraid?: string; wbraid?: string },
  url = "https://example.nl",
) {
  const website = await createWebsite(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      name: "Site",
      url,
    },
    { resolver: publicResolver },
  );
  const enabled = await enableWebsiteTracking({
    organizationId: owner.organization.id,
    websiteId: website.id,
  });
  const session = await ingestBrowserEvent({
    siteKey: enabled.siteKey,
    originHeader: url,
    monitorHeader: null,
    payload: {
      type: "session",
      eventId: randomUUID(),
      consent: "granted",
      visitorId: randomUUID(),
      sessionId: randomUUID(),
      clickIds,
      landingPath: "/airco",
      landingOrigin: url,
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
  return { website, lead };
}

async function customerId(organizationId: string) {
  const customer = await database.googleAdsCustomer.findFirstOrThrow({
    where: { organizationId, googleCustomerId: "2222222222" },
  });
  return customer;
}

describe("Google Ads revenue analytics", () => {
  it("enables analytics with Ads read scope and without Data Manager", async () => {
    const owner = await connect("Analytics Ads Only");
    const { website } = await trackedLead(owner, {
      gclid: "gclid-analytics-1",
    });
    const customer = await customerId(owner.organization.id);
    const config = await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    expect(config.status).toBe("ACTIVE");
    const overview = await getAnalyticsSetupOverview(
      owner.user.id,
      owner.organization.slug,
    );
    expect(overview.capabilities.dataManagerStatus).not.toBe("READY");
  });

  it("upserts daily performance and applies later Google corrections", async () => {
    const owner = await connect("Analytics Upsert");
    const { website } = await trackedLead(owner, { gclid: "gclid-upsert" });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    const today = todayInTimeZone(new Date(), "Europe/Amsterdam");
    resetFakeGoogleAdsWorld({
      customerDaily: {
        "2222222222": [
          {
            date: today,
            costMicros: 500_000_000n,
            clicks: 10n,
            impressions: 100n,
          },
        ],
      },
      campaignDaily: {
        "2222222222": [
          {
            date: today,
            campaignId: "100",
            campaignName: "Airco Amsterdam",
            campaignStatus: "ENABLED",
            advertisingChannelType: "SEARCH",
            costMicros: 500_000_000n,
            clicks: 10n,
            impressions: 100n,
          },
        ],
      },
    });
    await executeGoogleAdsAnalyticsSync({
      googleAdsCustomerId: customer.id,
      organizationId: owner.organization.id,
      kind: "RECENT",
    });
    resetFakeGoogleAdsWorld({
      customerDaily: {
        "2222222222": [
          {
            date: today,
            costMicros: 800_000_000n,
            clicks: 12n,
            impressions: 110n,
          },
        ],
      },
      campaignDaily: {
        "2222222222": [
          {
            date: today,
            campaignId: "100",
            campaignName: "Airco Amsterdam Renamed",
            campaignStatus: "PAUSED",
            advertisingChannelType: "SEARCH",
            costMicros: 800_000_000n,
            clicks: 12n,
            impressions: 110n,
          },
        ],
      },
    });
    await executeGoogleAdsAnalyticsSync({
      googleAdsCustomerId: customer.id,
      organizationId: owner.organization.id,
      kind: "RECENT",
    });
    const rows = await database.googleAdsPerformanceDaily.findMany({
      where: { googleAdsCustomerId: customer.id },
    });
    expect(rows).toHaveLength(2);
    const account = rows.find((row) => row.dimensionType === "ACCOUNT");
    expect(account?.costMicros).toBe(800_000_000n);
    const campaign = rows.find((row) => row.dimensionType === "CAMPAIGN");
    expect(campaign?.campaignId).toBe("100");
    expect(campaign?.campaignNameSnapshot).toBe("Airco Amsterdam Renamed");
    expect(campaign?.campaignStatus).toBe("PAUSED");
  });

  it("keeps last known spend when Google reporting fails", async () => {
    const owner = await connect("Analytics Fail");
    const { website } = await trackedLead(owner, { gclid: "gclid-fail" });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    const today = todayInTimeZone(new Date(), "Europe/Amsterdam");
    resetFakeGoogleAdsWorld({
      customerDaily: {
        "2222222222": [
          {
            date: today,
            costMicros: 100_000_000n,
            clicks: 1n,
            impressions: 10n,
          },
        ],
      },
    });
    await executeGoogleAdsAnalyticsSync({
      googleAdsCustomerId: customer.id,
      organizationId: owner.organization.id,
      kind: "RECENT",
    });
    resetFakeGoogleAdsWorld({ failAnalyticsFor: ["2222222222"] });
    await expect(
      executeGoogleAdsAnalyticsSync({
        googleAdsCustomerId: customer.id,
        organizationId: owner.organization.id,
        kind: "RECENT",
      }),
    ).rejects.toThrow();
    const remaining = await database.googleAdsPerformanceDaily.findMany({
      where: { googleAdsCustomerId: customer.id },
    });
    expect(remaining[0]?.costMicros).toBe(100_000_000n);
    const config = await database.googleAdsAnalyticsConfig.findFirstOrThrow({
      where: { websiteId: website.id },
    });
    expect(config.status).toBe("ERROR");
  });

  it("resolves a GCLID via ClickView onto the campaign id", async () => {
    const owner = await connect("ClickView Resolve");
    const { website, lead } = await trackedLead(owner, {
      gclid: "gclid-campaign-123",
    });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    const today = todayInTimeZone(new Date(), "Europe/Amsterdam");
    resetFakeGoogleAdsWorld({
      clickViews: {
        "2222222222": [
          {
            date: today,
            gclid: "gclid-campaign-123",
            campaignId: "123",
            campaignName: "Exact Campaign",
            campaignStatus: "ENABLED",
            advertisingChannelType: "SEARCH",
            adGroupId: "9",
            adGroupName: "Group",
            adId: "8",
            keywordCriterionId: "7",
            keywordText: "airco",
            keywordMatchType: "EXACT",
          },
        ],
      },
      customerDaily: {
        "2222222222": [
          {
            date: today,
            costMicros: 1_000_000_000n,
            clicks: 10n,
            impressions: 20n,
          },
        ],
      },
      campaignDaily: {
        "2222222222": [
          {
            date: today,
            campaignId: "123",
            campaignName: "Exact Campaign",
            campaignStatus: "ENABLED",
            advertisingChannelType: "SEARCH",
            costMicros: 1_000_000_000n,
            clicks: 10n,
            impressions: 20n,
          },
        ],
      },
    });
    await executeGoogleAdsAnalyticsSync({
      googleAdsCustomerId: customer.id,
      organizationId: owner.organization.id,
      kind: "RECENT",
    });
    await ensureLeadClickResolution({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await executeGoogleAdsClickResolution({
      organizationId: owner.organization.id,
      googleAdsCustomerId: customer.id,
    });
    await applyLeadOutcomeMutation({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      leadId: lead.id,
      mutationId: randomUUID(),
      expectedVersion: 1,
      status: "WON",
      revenue: { amount: "4500.00", currency: "EUR" },
    });
    const resolution =
      await database.googleAdsLeadAttributionResolution.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
    expect(resolution.status).toBe("CAMPAIGN_RESOLVED");
    expect(resolution.campaignId).toBe("123");
    const dashboard = await getRevenueAnalyticsDashboard(
      owner.user.id,
      owner.organization.slug,
      { range: "30" },
    );
    expect(dashboard.analytics?.campaigns[0]?.campaignId).toBe("123");
    expect(dashboard.analytics?.campaigns[0]?.revenue.formatted).toBe(
      "€4,500.00",
    );
    expect(dashboard.analytics?.realRoas.formatted).toBe("4.50x");
  });

  it("keeps WBRAID account-attributed and campaign unresolved", async () => {
    const owner = await connect("Braid Unresolved");
    const { website, lead } = await trackedLead(owner, {
      wbraid: "wbraid-no-campaign",
    });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    await ensureLeadClickResolution({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await executeGoogleAdsClickResolution({
      organizationId: owner.organization.id,
      googleAdsCustomerId: customer.id,
    });
    const resolution =
      await database.googleAdsLeadAttributionResolution.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
    expect(resolution.status).toBe("UNSUPPORTED_IDENTIFIER");
    expect(resolution.campaignId).toBeNull();
  });

  it("does not guess a campaign from a shared Final URL", async () => {
    const owner = await connect("No Url Guess");
    const { website, lead } = await trackedLead(owner, {
      gclid: "gclid-missing",
    });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    const today = todayInTimeZone(new Date(), "Europe/Amsterdam");
    resetFakeGoogleAdsWorld({
      clickViews: { "2222222222": [] },
      campaignDaily: {
        "2222222222": [
          {
            date: today,
            campaignId: "100",
            campaignName: "Airco Amsterdam",
            campaignStatus: "ENABLED",
            advertisingChannelType: "SEARCH",
            costMicros: 1n,
            clicks: 1n,
            impressions: 1n,
          },
          {
            date: today,
            campaignId: "500",
            campaignName: "Performance Max – Airco",
            campaignStatus: "ENABLED",
            advertisingChannelType: "PERFORMANCE_MAX",
            costMicros: 1n,
            clicks: 1n,
            impressions: 1n,
          },
        ],
      },
    });
    await ensureLeadClickResolution({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await executeGoogleAdsClickResolution({
      organizationId: owner.organization.id,
      googleAdsCustomerId: customer.id,
    });
    const resolution =
      await database.googleAdsLeadAttributionResolution.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
    expect(resolution.status).toBe("NOT_FOUND");
    expect(resolution.campaignId).toBeNull();
  });

  it("counts customer spend once for two websites mapped to the same account", async () => {
    const owner = await connect("Two Sites");
    const first = await trackedLead(owner, { gclid: "gclid-site-a" });
    const second = await trackedLead(
      owner,
      { gclid: "gclid-site-b" },
      "https://example.com",
    );
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: first.website.id,
      googleAdsCustomerId: customer.id,
    });
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: second.website.id,
      googleAdsCustomerId: customer.id,
    });
    const today = todayInTimeZone(new Date(), "Europe/Amsterdam");
    resetFakeGoogleAdsWorld({
      customerDaily: {
        "2222222222": [
          {
            date: today,
            costMicros: 1_000_000_000n,
            clicks: 10n,
            impressions: 20n,
          },
        ],
      },
    });
    await executeGoogleAdsAnalyticsSync({
      googleAdsCustomerId: customer.id,
      organizationId: owner.organization.id,
      kind: "RECENT",
    });
    const dashboard = await getRevenueAnalyticsDashboard(
      owner.user.id,
      owner.organization.slug,
      { range: "30" },
    );
    expect(dashboard.analytics?.spend.formatted).toBe("€1,000.00");
    expect(dashboard.analytics?.clicks.value).toBe(10);
  });

  it("forbids MEMBER mapping changes and isolates tenants", async () => {
    const owner = await connect("Member Analytics");
    const member = await createTestUser("Member Analytics User");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    const { website } = await trackedLead(owner, { gclid: "gclid-member" });
    const customer = await customerId(owner.organization.id);
    await expect(
      enableGoogleAdsAnalytics({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
        googleAdsCustomerId: customer.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    const other = await connect("Other Tenant Analytics");
    const visible = await getRevenueAnalyticsDashboard(
      other.user.id,
      other.organization.slug,
      { range: "30" },
    );
    expect(visible.empty).toBe(true);
    const own = await getRevenueAnalyticsDashboard(
      member.id,
      owner.organization.slug,
      { range: "30" },
    );
    expect(own.empty).toBe(false);
  });

  it("marks clicks outside ClickView lookback without infinite retry", async () => {
    const owner = await connect("Lookback");
    const { website, lead } = await trackedLead(owner, {
      gclid: "gclid-old",
    });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    await database.attributionTouch.update({
      where: { id: lead.attribution!.primaryTouchId! },
      data: { capturedAt: new Date("2026-01-01T10:00:00.000Z") },
    });
    await ensureLeadClickResolution({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await executeGoogleAdsClickResolution({
      organizationId: owner.organization.id,
      googleAdsCustomerId: customer.id,
    });
    const resolution =
      await database.googleAdsLeadAttributionResolution.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
    expect(resolution.status).toBe("OUTSIDE_LOOKBACK");
    expect(resolution.nextAttemptAt).toBeNull();
  });

  it("retries ClickView API failures without inventing a campaign", async () => {
    const owner = await connect("Click Fail");
    const { website, lead } = await trackedLead(owner, {
      gclid: "gclid-api-fail",
    });
    const customer = await customerId(owner.organization.id);
    await enableGoogleAdsAnalytics({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: website.id,
      googleAdsCustomerId: customer.id,
    });
    resetFakeGoogleAdsWorld({ failClickViewFor: ["2222222222"] });
    await ensureLeadClickResolution({
      leadId: lead.id,
      organizationId: owner.organization.id,
    });
    await executeGoogleAdsClickResolution({
      organizationId: owner.organization.id,
      googleAdsCustomerId: customer.id,
    });
    const resolution =
      await database.googleAdsLeadAttributionResolution.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
    expect(resolution.status).toBe("ERROR");
    expect(resolution.campaignId).toBeNull();
    expect(resolution.nextAttemptAt).not.toBeNull();
  });
});
