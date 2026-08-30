import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import {
  completeGoogleAdsOAuth,
  startGoogleAdsOAuth,
} from "@/server/google-ads/oauth";
import {
  approveGoogleAdsDestinationDomain,
  disconnectGoogleAds,
  discoverGoogleAdsAccounts,
  getGoogleAdsDestination,
  getGoogleAdsOverview,
  selectGoogleAdsCustomers,
} from "@/server/google-ads/service";
import { executeGoogleAdsSyncJob } from "@/server/google-ads/sync";
import { resetFakeGoogleAdsWorld } from "@/server/google-ads/fake-provider";
import { createWebsite } from "@/server/websites/service";
import { createTestOwner, deleteTestData } from "@/test/helpers";
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

async function connectOwner(name: string) {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
  const url = await startGoogleAdsOAuth({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
  });
  const state = new URL(url, "http://localhost:3000").searchParams.get(
    "state",
  )!;
  await completeGoogleAdsOAuth({
    userId: owner.user.id,
    code: "fake-google-ads-code",
    state,
  });
  await discoverGoogleAdsAccounts({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
  });
  return owner;
}

async function syncCustomer(owner: Awaited<ReturnType<typeof connectOwner>>) {
  const connection = await database.googleAdsConnection.findUniqueOrThrow({
    where: { organizationId: owner.organization.id },
  });
  return executeGoogleAdsSyncJob({
    connectionId: connection.id,
    googleAdsCustomerId: "2222222222",
  });
}

describe("Google Ads account access", () => {
  it("discovers MCC children and refuses manager selection or arbitrary IDs", async () => {
    const owner = await connectOwner("Ads Accounts");
    const customers = await database.googleAdsCustomer.findMany({
      where: { organizationId: owner.organization.id },
    });
    expect(customers.map((item) => item.googleCustomerId).sort()).toEqual([
      "1111111111",
      "2222222222",
      "3333333333",
    ]);
    await expect(
      selectGoogleAdsCustomers({
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        googleCustomerIds: ["1111111111"],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      selectGoogleAdsCustomers({
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        googleCustomerIds: ["9999999999"],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const selected = await database.googleAdsCustomer.findMany({
      where: { organizationId: owner.organization.id, selected: true },
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.googleCustomerId).toBe("2222222222");
  });
});

describe("Google Ads destination sync", () => {
  it("dedupes ads, PMax and observed URLs onto one monitorable target", async () => {
    const owner = await connectOwner("Ads Dedupe");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const targets = await database.googleAdsDestinationTarget.findMany({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/airco",
      },
      include: { references: true, monitor: true },
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.references.length).toBeGreaterThanOrEqual(4);
    expect(targets[0]?.monitor?.type).toBe("AD_DESTINATION");
    expect(targets[0]?.hasActiveSource).toBe(true);
  });

  it("does not treat paused campaign/ad-group/ad chains as active", async () => {
    const owner = await connectOwner("Ads Paused");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const paused = await database.googleAdsDestinationTarget.findFirst({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/paused",
      },
      include: { references: true, monitor: true },
    });
    expect(paused?.hasActiveSource).toBe(false);
    expect(paused?.monitorId).toBeNull();
  });

  it("stores Performance Max, mobile and observed sources", async () => {
    const owner = await connectOwner("Ads Sources");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const pmax = await database.googleAdsDestinationReference.findFirst({
      where: {
        sourceType: "ASSET_GROUP",
        customer: { organizationId: owner.organization.id },
      },
    });
    expect(pmax?.assetGroupName).toBe("Daikin");
    const observed = await database.googleAdsDestinationTarget.findFirst({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/expanded-page",
      },
      include: { references: true },
    });
    expect(observed?.references[0]?.sourceType).toBe("EXPANDED_LANDING_PAGE");
    const mobile = await database.googleAdsDestinationTarget.findFirst({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/airco-mobile",
      },
    });
    expect(mobile).toBeTruthy();
  });

  it("does not monitor unresolved macros or private IPs", async () => {
    resetFakeGoogleAdsWorld({
      standardAds: {
        "2222222222": [
          {
            campaignId: "1",
            campaignName: "Unsafe",
            campaignStatus: "ENABLED",
            advertisingChannelType: "SEARCH",
            adGroupId: "2",
            adGroupName: "Group",
            adGroupStatus: "ENABLED",
            adId: "3",
            adStatus: "ENABLED",
            adPrimaryStatus: "ELIGIBLE",
            adType: "RESPONSIVE_SEARCH_AD",
            finalUrls: [
              "https://example.nl/{_landing}",
              "http://169.254.169.254/",
            ],
            finalMobileUrls: [],
          },
        ],
      },
      performanceMax: {},
      observed: {},
    });
    const owner = await connectOwner("Ads Unsafe");
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const targets = await database.googleAdsDestinationTarget.findMany({
      where: { organizationId: owner.organization.id },
    });
    expect(targets.every((item) => item.monitorId === null)).toBe(true);
    expect(targets.some((item) => item.approvalStatus === "UNSUPPORTED")).toBe(
      true,
    );
    expect(targets.some((item) => item.approvalStatus === "BLOCKED")).toBe(
      true,
    );
  });

  it("requires approval for a new domain and auto-monitors an approved host", async () => {
    const owner = await connectOwner("Ads Approval");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const unknown = await database.googleAdsDestinationTarget.findFirst({
      where: {
        organizationId: owner.organization.id,
        sourceUrl: { contains: "campaign-landing.example" },
      },
    });
    expect(unknown?.approvalStatus).toBe("NEEDS_APPROVAL");
    expect(unknown?.monitorId).toBeNull();
    await approveGoogleAdsDestinationDomain({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      targetId: unknown!.id,
      resolver: publicResolver,
    });
    const approved = await database.googleAdsDestinationTarget.findUnique({
      where: { id: unknown!.id },
    });
    expect(approved?.approvalStatus).toBe("APPROVED");
    expect(approved?.monitorId).toBeTruthy();
  });

  it("does not deactivate unseen sources on a partial sync", async () => {
    const owner = await connectOwner("Ads Partial");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const before = await database.googleAdsDestinationReference.count({
      where: {
        customer: { organizationId: owner.organization.id },
        sourceActive: true,
      },
    });
    resetFakeGoogleAdsWorld({ failHalfwayFor: ["2222222222"] });
    await syncCustomer(owner).catch(() => "failed");
    const after = await database.googleAdsDestinationReference.count({
      where: {
        customer: { organizationId: owner.organization.id },
        sourceActive: true,
      },
    });
    expect(after).toBe(before);
  });

  it("marks removed sources inactive after a successful full sync", async () => {
    const owner = await connectOwner("Ads Removal");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    resetFakeGoogleAdsWorld({
      standardAds: { "2222222222": [] },
      performanceMax: {},
      observed: {},
    });
    const result = await syncCustomer(owner);
    expect(result).toBe("completed");
    const active = await database.googleAdsDestinationReference.count({
      where: {
        customer: { organizationId: owner.organization.id },
        sourceActive: true,
      },
    });
    expect(active).toBe(0);
  });

  it("resumes monitoring when a source is enabled again unless the user paused", async () => {
    const owner = await connectOwner("Ads Reactivate");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const target = await database.googleAdsDestinationTarget.findFirstOrThrow({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/airco",
      },
    });
    await database.monitor.update({
      where: { id: target.monitorId! },
      data: { status: "PAUSED" },
    });
    resetFakeGoogleAdsWorld({
      standardAds: { "2222222222": [] },
      performanceMax: {},
      observed: {},
    });
    await syncCustomer(owner);
    resetFakeGoogleAdsWorld();
    await syncCustomer(owner);
    const resumed = await database.monitor.findUniqueOrThrow({
      where: { id: target.monitorId! },
    });
    expect(resumed.status).toBe("ACTIVE");
    await database.adDestinationConfig.update({
      where: { monitorId: target.monitorId! },
      data: { userPaused: true },
    });
    await database.monitor.update({
      where: { id: target.monitorId! },
      data: { status: "PAUSED" },
    });
    await syncCustomer(owner);
    const stillPaused = await database.monitor.findUniqueOrThrow({
      where: { id: target.monitorId! },
    });
    expect(stillPaused.status).toBe("PAUSED");
  });

  it("keeps cached destinations monitored when Google Ads is temporarily down", async () => {
    const owner = await connectOwner("Ads Outage");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const target = await database.googleAdsDestinationTarget.findFirstOrThrow({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/airco",
      },
      include: { monitor: true },
    });
    expect(target.monitor?.status).toBe("ACTIVE");
    resetFakeGoogleAdsWorld({ failSyncFor: ["2222222222"] });
    const result = await syncCustomer(owner).catch(() => "failed");
    expect(result).toBe("failed");
    const still = await database.monitor.findUniqueOrThrow({
      where: { id: target.monitorId! },
    });
    expect(still.status).toBe("ACTIVE");
  });

  it("marks the connection for reauth without opening a customer incident", async () => {
    const owner = await connectOwner("Ads Revoked");
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    resetFakeGoogleAdsWorld({ revoked: true });
    await syncCustomer(owner);
    const connection = await database.googleAdsConnection.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(connection.status).toBe("REAUTH_REQUIRED");
    const incidents = await database.incident.count({
      where: {
        monitor: { website: { organizationId: owner.organization.id } },
      },
    });
    expect(incidents).toBe(0);
  });
});

describe("Google Ads incidents and isolation", () => {
  it("opens one incident for a destination used by multiple ads", async () => {
    const owner = await connectOwner("Ads Incident");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const target = await database.googleAdsDestinationTarget.findFirstOrThrow({
      where: {
        organizationId: owner.organization.id,
        normalizedUrl: "https://example.nl/airco",
      },
    });
    const result = {
      status: "FAILURE" as const,
      httpStatus: 404,
      responseTimeMs: 80,
      requestedUrl: "https://example.nl/airco",
      finalUrl: "https://example.nl/airco",
      redirectCount: 0,
      resolvedIp: "93.184.216.34",
      errorType: "HTTP_404" as const,
      errorMessage: "HTTP 404",
    };
    await persistAndProcessCheck({
      monitorId: target.monitorId!,
      organizationId: owner.organization.id,
      websiteId: target.websiteId!,
      startedAt: new Date(),
      finishedAt: new Date(),
      result,
    });
    await persistAndProcessCheck({
      monitorId: target.monitorId!,
      organizationId: owner.organization.id,
      websiteId: target.websiteId!,
      startedAt: new Date(),
      finishedAt: new Date(),
      result,
    });
    const incidents = await database.incident.findMany({
      where: { monitorId: target.monitorId! },
    });
    expect(incidents).toHaveLength(1);
  });

  it("blocks tenant B from reading tenant A destinations", async () => {
    const ownerA = await connectOwner("Ads Tenant A");
    const ownerB = await connectOwner("Ads Tenant B");
    await selectGoogleAdsCustomers({
      userId: ownerA.user.id,
      organizationSlug: ownerA.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const target = await database.googleAdsDestinationTarget.findFirstOrThrow({
      where: { organizationId: ownerA.organization.id },
    });
    await expect(
      getGoogleAdsDestination(
        ownerB.user.id,
        ownerB.organization.slug,
        target.id,
      ),
    ).rejects.toBeInstanceOf(DomainError);
    const overviewB = await getGoogleAdsOverview(
      ownerB.user.id,
      ownerB.organization.slug,
    );
    expect(
      overviewB.destinations.every(
        (item) => item.organizationId !== ownerA.organization.id,
      ),
    ).toBe(true);
    await expect(
      disconnectGoogleAds({
        userId: ownerB.user.id,
        organizationSlug: ownerA.organization.slug,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("keeps history after disconnect and removes the refresh credential", async () => {
    const owner = await connectOwner("Ads Disconnect");
    await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Example NL",
        url: "https://example.nl",
      },
      { resolver: publicResolver },
    );
    await selectGoogleAdsCustomers({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      googleCustomerIds: ["2222222222"],
    });
    const before = await database.googleAdsDestinationTarget.count({
      where: { organizationId: owner.organization.id },
    });
    await disconnectGoogleAds({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
    });
    const connection = await database.googleAdsConnection.findUniqueOrThrow({
      where: { organizationId: owner.organization.id },
    });
    expect(connection.status).toBe("DISCONNECTED");
    expect(connection.encryptedRefreshToken).toBeNull();
    const after = await database.googleAdsDestinationTarget.count({
      where: { organizationId: owner.organization.id },
    });
    expect(after).toBe(before);
  });
});
