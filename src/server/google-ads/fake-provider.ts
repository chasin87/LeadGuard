import type {
  GoogleAdsAccount,
  GoogleAdsAuthClient,
  GoogleAdsDailyLandingPageMetric,
  GoogleAdsHourlySourceMetric,
  GoogleAdsObservedLandingPage,
  GoogleAdsOAuthTokenSet,
  GoogleAdsPerformanceMaxDestination,
  GoogleAdsReadProvider,
  GoogleAdsStandardAdDestination,
} from "@/server/google-ads/provider";

export type FakeGoogleAdsWorld = {
  accessibleCustomerIds: string[];
  accounts: GoogleAdsAccount[];
  standardAds: Record<string, GoogleAdsStandardAdDestination[]>;
  performanceMax: Record<string, GoogleAdsPerformanceMaxDestination[]>;
  observed: Record<string, GoogleAdsObservedLandingPage[]>;
  hourlyAdMetrics: Record<string, GoogleAdsHourlySourceMetric[]>;
  hourlyAssetGroupMetrics: Record<string, GoogleAdsHourlySourceMetric[]>;
  dailyLandingPages: Record<string, GoogleAdsDailyLandingPageMetric[]>;
  dailyExpandedLandingPages: Record<string, GoogleAdsDailyLandingPageMetric[]>;
  failSyncFor: string[];
  failHalfwayFor: string[];
  failMetricsFor: string[];
  revoked: boolean;
  accessLostCustomerIds: string[];
};

const defaultWorld = (): FakeGoogleAdsWorld => ({
  accessibleCustomerIds: ["1111111111", "2222222222"],
  accounts: [
    {
      googleCustomerId: "1111111111",
      descriptiveName: "Voltios Manager",
      currencyCode: "EUR",
      timeZone: "Europe/Amsterdam",
      isManager: true,
      status: "ENABLED",
      loginCustomerId: null,
    },
    {
      googleCustomerId: "2222222222",
      descriptiveName: "Voltios Energie",
      currencyCode: "EUR",
      timeZone: "Europe/Amsterdam",
      isManager: false,
      status: "ENABLED",
      loginCustomerId: "1111111111",
    },
    {
      googleCustomerId: "3333333333",
      descriptiveName: "Laadpaaltje.com",
      currencyCode: "EUR",
      timeZone: "Europe/Amsterdam",
      isManager: false,
      status: "ENABLED",
      loginCustomerId: "1111111111",
    },
  ],
  standardAds: {
    "2222222222": [
      {
        campaignId: "100",
        campaignName: "Airco Amsterdam",
        campaignStatus: "ENABLED",
        advertisingChannelType: "SEARCH",
        adGroupId: "200",
        adGroupName: "Daikin airco",
        adGroupStatus: "ENABLED",
        adId: "1001",
        adStatus: "ENABLED",
        adPrimaryStatus: "ELIGIBLE",
        adType: "RESPONSIVE_SEARCH_AD",
        finalUrls: ["https://example.nl/airco"],
        finalMobileUrls: ["https://example.nl/airco"],
      },
      {
        campaignId: "100",
        campaignName: "Airco Amsterdam",
        campaignStatus: "ENABLED",
        advertisingChannelType: "SEARCH",
        adGroupId: "200",
        adGroupName: "Daikin airco",
        adGroupStatus: "ENABLED",
        adId: "1002",
        adStatus: "ENABLED",
        adPrimaryStatus: "ELIGIBLE",
        adType: "RESPONSIVE_SEARCH_AD",
        finalUrls: ["https://example.nl/airco"],
        finalMobileUrls: [],
      },
      {
        campaignId: "101",
        campaignName: "Paused campaign",
        campaignStatus: "PAUSED",
        advertisingChannelType: "SEARCH",
        adGroupId: "201",
        adGroupName: "Paused group",
        adGroupStatus: "ENABLED",
        adId: "1003",
        adStatus: "ENABLED",
        adPrimaryStatus: "PAUSED",
        adType: "RESPONSIVE_SEARCH_AD",
        finalUrls: ["https://example.nl/paused"],
        finalMobileUrls: [],
      },
      {
        campaignId: "102",
        campaignName: "New domain campaign",
        campaignStatus: "ENABLED",
        advertisingChannelType: "SEARCH",
        adGroupId: "202",
        adGroupName: "Landing",
        adGroupStatus: "ENABLED",
        adId: "1004",
        adStatus: "ENABLED",
        adPrimaryStatus: "ELIGIBLE",
        adType: "RESPONSIVE_SEARCH_AD",
        finalUrls: ["https://campaign-landing.example/offer"],
        finalMobileUrls: [],
      },
      {
        campaignId: "103",
        campaignName: "Template campaign",
        campaignStatus: "ENABLED",
        advertisingChannelType: "SEARCH",
        adGroupId: "203",
        adGroupName: "Macros",
        adGroupStatus: "ENABLED",
        adId: "1005",
        adStatus: "ENABLED",
        adPrimaryStatus: "ELIGIBLE",
        adType: "RESPONSIVE_SEARCH_AD",
        finalUrls: ["https://example.nl/{_landing}"],
        finalMobileUrls: [],
      },
    ],
    "3333333333": [
      {
        campaignId: "300",
        campaignName: "Laadpalen",
        campaignStatus: "ENABLED",
        advertisingChannelType: "SEARCH",
        adGroupId: "400",
        adGroupName: "Home",
        adGroupStatus: "ENABLED",
        adId: "3001",
        adStatus: "ENABLED",
        adPrimaryStatus: "ELIGIBLE",
        adType: "RESPONSIVE_SEARCH_AD",
        finalUrls: ["https://example.com/"],
        finalMobileUrls: [],
      },
    ],
  },
  performanceMax: {
    "2222222222": [
      {
        campaignId: "500",
        campaignName: "Performance Max – Airco",
        campaignStatus: "ENABLED",
        advertisingChannelType: "PERFORMANCE_MAX",
        assetGroupId: "600",
        assetGroupName: "Daikin",
        assetGroupStatus: "ENABLED",
        assetGroupPrimaryStatus: "ELIGIBLE",
        finalUrls: ["https://example.nl/airco"],
        finalMobileUrls: ["https://example.nl/airco-mobile"],
      },
    ],
  },
  observed: {
    "2222222222": [
      {
        expandedFinalUrl: "https://example.nl/expanded-page",
        landingPageSource: "ADVERTISER_PROVIDED",
        campaignId: "100",
        campaignName: "Airco Amsterdam",
        campaignStatus: "ENABLED",
      },
      {
        expandedFinalUrl: "https://example.nl/airco",
        landingPageSource: "URL_EXPANSION",
        campaignId: "500",
        campaignName: "Performance Max – Airco",
        campaignStatus: "ENABLED",
      },
    ],
  },
  failSyncFor: [],
  failHalfwayFor: [],
  failMetricsFor: [],
  hourlyAdMetrics: {
    "2222222222": [
      {
        sourceType: "AD_GROUP_AD",
        sourceEntityId: "1001",
        date: "2026-08-30",
        hour: 14,
        clicks: 10n,
        costMicros: 60_000_000n,
        impressions: 100n,
      },
      {
        sourceType: "AD_GROUP_AD",
        sourceEntityId: "1001",
        date: "2026-08-30",
        hour: 15,
        clicks: 20n,
        costMicros: 120_000_000n,
        impressions: 200n,
      },
    ],
  },
  hourlyAssetGroupMetrics: {},
  dailyLandingPages: {
    "2222222222": [
      {
        kind: "UNEXPANDED",
        url: "https://example.nl/airco",
        date: "2026-08-30",
        clicks: 80n,
        costMicros: 240_000_000n,
        impressions: 900n,
      },
    ],
  },
  dailyExpandedLandingPages: {},
  revoked: false,
  accessLostCustomerIds: [],
});

let world: FakeGoogleAdsWorld = defaultWorld();

export function resetFakeGoogleAdsWorld(
  patch: Partial<FakeGoogleAdsWorld> = {},
): FakeGoogleAdsWorld {
  world = { ...defaultWorld(), ...patch };
  if (patch.accounts) world.accounts = patch.accounts;
  if (patch.standardAds) world.standardAds = patch.standardAds;
  if (patch.performanceMax) world.performanceMax = patch.performanceMax;
  if (patch.observed) world.observed = patch.observed;
  if (patch.hourlyAdMetrics) world.hourlyAdMetrics = patch.hourlyAdMetrics;
  if (patch.hourlyAssetGroupMetrics) {
    world.hourlyAssetGroupMetrics = patch.hourlyAssetGroupMetrics;
  }
  if (patch.dailyLandingPages)
    world.dailyLandingPages = patch.dailyLandingPages;
  if (patch.dailyExpandedLandingPages) {
    world.dailyExpandedLandingPages = patch.dailyExpandedLandingPages;
  }
  return world;
}

export function getFakeGoogleAdsWorld(): FakeGoogleAdsWorld {
  return world;
}

async function* iterate<T>(items: T[], failHalfway = false): AsyncIterable<T> {
  const halfway = Math.max(1, Math.floor(items.length / 2));
  let index = 0;
  for (const item of items) {
    if (failHalfway && index >= halfway) {
      throw new Error("GOOGLE_ADS_FAKE_PARTIAL");
    }
    index += 1;
    yield item;
  }
}

export function createFakeGoogleAdsReadProvider(): GoogleAdsReadProvider {
  return {
    async listAccessibleCustomers() {
      if (world.revoked) {
        const error = new Error("invalid_grant");
        error.name = "GoogleAdsAuthError";
        throw error;
      }
      return [...world.accessibleCustomerIds];
    },
    async getCustomer(_session, googleCustomerId) {
      if (world.accessLostCustomerIds.includes(googleCustomerId)) {
        const error = new Error("PERMISSION_DENIED");
        error.name = "GoogleAdsAccessLostError";
        throw error;
      }
      const account = world.accounts.find(
        (item) => item.googleCustomerId === googleCustomerId,
      );
      if (!account) {
        const error = new Error("PERMISSION_DENIED");
        error.name = "GoogleAdsAccessLostError";
        throw error;
      }
      return account;
    },
    async getCustomerHierarchy(_session, managerCustomerId) {
      return world.accounts.filter(
        (item) =>
          item.googleCustomerId === managerCustomerId ||
          item.loginCustomerId === managerCustomerId,
      );
    },
    syncStandardAdDestinations(_session, googleCustomerId) {
      if (world.failSyncFor.includes(googleCustomerId)) {
        throw new Error("GOOGLE_ADS_UNAVAILABLE");
      }
      return iterate(
        world.standardAds[googleCustomerId] ?? [],
        world.failHalfwayFor.includes(googleCustomerId),
      );
    },
    syncPerformanceMaxDestinations(_session, googleCustomerId) {
      return iterate(world.performanceMax[googleCustomerId] ?? []);
    },
    syncObservedLandingPages(_session, googleCustomerId) {
      return iterate(world.observed[googleCustomerId] ?? []);
    },
    async getAdHourlyMetrics(_session, googleCustomerId, input) {
      if (world.failMetricsFor.includes(googleCustomerId)) {
        throw new Error("GOOGLE_ADS_UNAVAILABLE");
      }
      const wanted = new Set(input.adIds);
      return (world.hourlyAdMetrics[googleCustomerId] ?? []).filter(
        (row) =>
          wanted.has(row.sourceEntityId) &&
          row.date >= input.fromDate &&
          row.date <= input.toDate,
      );
    },
    async getAssetGroupHourlyMetrics(_session, googleCustomerId, input) {
      if (world.failMetricsFor.includes(googleCustomerId)) {
        throw new Error("GOOGLE_ADS_UNAVAILABLE");
      }
      const wanted = new Set(input.assetGroupIds);
      return (world.hourlyAssetGroupMetrics[googleCustomerId] ?? []).filter(
        (row) =>
          wanted.has(row.sourceEntityId) &&
          row.date >= input.fromDate &&
          row.date <= input.toDate,
      );
    },
    async getLandingPageDailyMetrics(_session, googleCustomerId, range) {
      if (world.failMetricsFor.includes(googleCustomerId)) {
        throw new Error("GOOGLE_ADS_UNAVAILABLE");
      }
      return (world.dailyLandingPages[googleCustomerId] ?? []).filter(
        (row) => row.date >= range.fromDate && row.date <= range.toDate,
      );
    },
    async getExpandedLandingPageDailyMetrics(
      _session,
      googleCustomerId,
      range,
    ) {
      if (world.failMetricsFor.includes(googleCustomerId)) {
        throw new Error("GOOGLE_ADS_UNAVAILABLE");
      }
      return (world.dailyExpandedLandingPages[googleCustomerId] ?? []).filter(
        (row) => row.date >= range.fromDate && row.date <= range.toDate,
      );
    },
  };
}

export function createFakeGoogleAdsAuthClient(): GoogleAdsAuthClient {
  return {
    createAuthorizationUrl(input) {
      return `/api/integrations/google-ads/fake/consent?state=${encodeURIComponent(input.state)}`;
    },
    async exchangeAuthorizationCode(input): Promise<GoogleAdsOAuthTokenSet> {
      if (input.code !== "fake-google-ads-code") {
        throw new Error("invalid_grant");
      }
      return {
        accessToken: "fake-access-token",
        refreshToken: "fake-refresh-token",
        expiresIn: 3600,
        email: "ads-user@example.com",
      };
    },
    async refreshAccessToken(input) {
      if (world.revoked || input.refreshToken !== "fake-refresh-token") {
        const error = new Error("invalid_grant");
        error.name = "GoogleAdsAuthError";
        throw error;
      }
      return { accessToken: "fake-access-token", expiresIn: 3600 };
    },
    async revokeToken() {
      world.revoked = true;
    },
  };
}
