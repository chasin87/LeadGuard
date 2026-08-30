export type GoogleAdsAccount = {
  googleCustomerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  isManager: boolean;
  status: string;
  loginCustomerId: string | null;
};

export type GoogleAdsStandardAdDestination = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  advertisingChannelType: string | null;
  adGroupId: string;
  adGroupName: string;
  adGroupStatus: string;
  adId: string;
  adStatus: string;
  adPrimaryStatus: string | null;
  adType: string | null;
  finalUrls: string[];
  finalMobileUrls: string[];
};

export type GoogleAdsPerformanceMaxDestination = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  advertisingChannelType: string | null;
  assetGroupId: string;
  assetGroupName: string;
  assetGroupStatus: string;
  assetGroupPrimaryStatus: string | null;
  finalUrls: string[];
  finalMobileUrls: string[];
};

export type GoogleAdsObservedLandingPage = {
  expandedFinalUrl: string;
  landingPageSource: string | null;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
};

export type GoogleAdsReadSession = {
  accessToken: string;
  developerToken: string;
  loginCustomerId: string | null;
};

export type GoogleAdsHourlySourceMetric = {
  sourceType: "AD_GROUP_AD" | "ASSET_GROUP";
  sourceEntityId: string;
  date: string;
  hour: number;
  clicks: bigint;
  costMicros: bigint;
  impressions: bigint;
};

export type GoogleAdsDailyLandingPageMetric = {
  kind: "UNEXPANDED" | "EXPANDED";
  url: string;
  date: string;
  clicks: bigint;
  costMicros: bigint;
  impressions: bigint;
};

export type GoogleAdsMetricDateRange = {
  fromDate: string;
  toDate: string;
};

/**
 * Read-only Google Ads access. This interface must never grow mutate/create/
 * update/remove/pause/conversion-upload methods.
 */
export type GoogleAdsReadProvider = {
  listAccessibleCustomers(session: GoogleAdsReadSession): Promise<string[]>;
  getCustomer(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
  ): Promise<GoogleAdsAccount>;
  getCustomerHierarchy(
    session: GoogleAdsReadSession,
    managerCustomerId: string,
  ): Promise<GoogleAdsAccount[]>;
  syncStandardAdDestinations(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
  ): AsyncIterable<GoogleAdsStandardAdDestination>;
  syncPerformanceMaxDestinations(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
  ): AsyncIterable<GoogleAdsPerformanceMaxDestination>;
  syncObservedLandingPages(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
    lookback: { fromDate: string; toDate: string },
  ): AsyncIterable<GoogleAdsObservedLandingPage>;
  getAdHourlyMetrics(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
    input: GoogleAdsMetricDateRange & { adIds: string[] },
  ): Promise<GoogleAdsHourlySourceMetric[]>;
  getAssetGroupHourlyMetrics(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
    input: GoogleAdsMetricDateRange & { assetGroupIds: string[] },
  ): Promise<GoogleAdsHourlySourceMetric[]>;
  getLandingPageDailyMetrics(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
    range: GoogleAdsMetricDateRange,
  ): Promise<GoogleAdsDailyLandingPageMetric[]>;
  getExpandedLandingPageDailyMetrics(
    session: GoogleAdsReadSession,
    googleCustomerId: string,
    range: GoogleAdsMetricDateRange,
  ): Promise<GoogleAdsDailyLandingPageMetric[]>;
};

export type GoogleAdsOAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  email: string | null;
};

export type GoogleAdsAuthClient = {
  createAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    clientId: string;
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<GoogleAdsOAuthTokenSet>;
  refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number | null }>;
  revokeToken(token: string): Promise<void>;
};
