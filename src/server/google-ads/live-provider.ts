import {
  googleAdsApiBaseUrl,
  googleAdsAuthUrl,
  googleAdsRevokeUrl,
  googleAdsTokenUrl,
  getGoogleAdsConfig,
} from "@/server/google-ads/config";
import { GoogleAdsProviderError } from "@/server/google-ads/errors";
import {
  asGoogleIdString,
  normalizeGoogleCustomerId,
  parseCustomerIdFromResourceName,
} from "@/server/google-ads/ids";
import type {
  GoogleAdsAccount,
  GoogleAdsAuthClient,
  GoogleAdsCampaignDailyPerformanceRow,
  GoogleAdsClickViewRow,
  GoogleAdsConversionActionRow,
  GoogleAdsCustomerDailyPerformanceRow,
  GoogleAdsDailyLandingPageMetric,
  GoogleAdsHourlySourceMetric,
  GoogleAdsObservedLandingPage,
  GoogleAdsOAuthTokenSet,
  GoogleAdsPerformanceMaxDestination,
  GoogleAdsReadProvider,
  GoogleAdsReadSession,
  GoogleAdsStandardAdDestination,
} from "@/server/google-ads/provider";
import { googleAdsQueries } from "@/server/google-ads/queries";
import { parseMicros } from "@/lib/google-ads/money";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function nested(source: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as JsonObject)[key];
  }, source);
}

function asHour(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

function asDate(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function chunkIds(ids: string[], size: number): string[][] {
  const unique = [
    ...new Set(ids.map((id) => id.trim()).filter((id) => /^\d+$/.test(id))),
  ];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

function metricTriple(row: JsonObject): {
  clicks: bigint;
  costMicros: bigint;
  impressions: bigint;
} {
  const metrics = asObject(row.metrics);
  return {
    clicks: parseMicros(metrics.clicks),
    costMicros: parseMicros(metrics.costMicros),
    impressions: parseMicros(metrics.impressions),
  };
}

function requestIdFromHeaders(headers: Headers): string | null {
  return (
    headers.get("request-id") ??
    headers.get("x-request-id") ??
    headers.get("google-request-id")
  );
}

function classifyHttpError(
  status: number,
  body: string,
  requestId: string | null,
): GoogleAdsProviderError {
  const lower = body.toLowerCase();
  const authFailure =
    status === 401 ||
    lower.includes("unauthenticated") ||
    lower.includes("invalid_grant") ||
    lower.includes("refresh token");
  const accessLost =
    status === 403 ||
    lower.includes("permission_denied") ||
    lower.includes("authorizationerror");
  const retryable =
    status === 429 ||
    status >= 500 ||
    lower.includes("resource_exhausted") ||
    lower.includes("unavailable");
  return new GoogleAdsProviderError({
    code: authFailure
      ? "AUTH_FAILURE"
      : accessLost
        ? "ACCESS_LOST"
        : retryable
          ? "TRANSIENT"
          : `HTTP_${status}`,
    message: "Google Ads request failed.",
    retryable,
    providerRequestId: requestId,
    authFailure,
    accessLost: accessLost && !authFailure,
  });
}

async function googleFetch(
  url: string,
  init: RequestInit,
  session?: GoogleAdsReadSession,
): Promise<{ json: JsonObject; requestId: string | null }> {
  const headers = new Headers(init.headers);
  if (session) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    headers.set("developer-token", session.developerToken);
    if (session.loginCustomerId) {
      headers.set("login-customer-id", session.loginCustomerId);
    }
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new GoogleAdsProviderError({
      code: "NETWORK",
      message: "Google Ads request failed.",
      retryable: true,
    });
  }
  const requestId = requestIdFromHeaders(response.headers);
  const text = await response.text();
  if (!response.ok) {
    throw classifyHttpError(response.status, text, requestId);
  }
  if (!text) return { json: {}, requestId };
  try {
    return { json: JSON.parse(text) as JsonObject, requestId };
  } catch {
    throw new GoogleAdsProviderError({
      code: "INVALID_RESPONSE",
      message: "Google Ads request failed.",
      providerRequestId: requestId,
    });
  }
}

async function* searchPages(
  session: GoogleAdsReadSession,
  googleCustomerId: string,
  query: string,
): AsyncIterable<JsonObject> {
  const config = getGoogleAdsConfig();
  let pageToken: string | undefined;
  const customerId = normalizeGoogleCustomerId(googleCustomerId);
  do {
    const { json } = await googleFetch(
      `${googleAdsApiBaseUrl}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        body: JSON.stringify({
          query,
          pageSize: config.searchPageSize,
          pageToken,
        }),
      },
      session,
    );
    const results = Array.isArray(json.results) ? json.results : [];
    for (const row of results) {
      yield asObject(row);
    }
    pageToken =
      typeof json.nextPageToken === "string" && json.nextPageToken
        ? json.nextPageToken
        : undefined;
  } while (pageToken);
}

function accountFromCustomerRow(
  row: JsonObject,
  loginCustomerId: string | null,
): GoogleAdsAccount {
  const customer = asObject(row.customer ?? row);
  return {
    googleCustomerId: asGoogleIdString(customer.id),
    descriptiveName:
      typeof customer.descriptiveName === "string"
        ? customer.descriptiveName
        : asGoogleIdString(customer.id),
    currencyCode:
      typeof customer.currencyCode === "string" ? customer.currencyCode : null,
    timeZone: typeof customer.timeZone === "string" ? customer.timeZone : null,
    isManager: customer.manager === true,
    status: typeof customer.status === "string" ? customer.status : "UNKNOWN",
    loginCustomerId,
  };
}

export function createLiveGoogleAdsReadProvider(): GoogleAdsReadProvider {
  return {
    async listAccessibleCustomers(session) {
      if (!session.developerToken) {
        throw new GoogleAdsProviderError({
          code: "PLATFORM_CONFIG",
          message:
            "Google Ads is not configured on this LeadGuard environment.",
          platformConfig: true,
        });
      }
      const { json } = await googleFetch(
        `${googleAdsApiBaseUrl}/customers:listAccessibleCustomers`,
        { method: "GET" },
        { ...session, loginCustomerId: null },
      );
      const names = asStringArray(json.resourceNames);
      return names
        .map(parseCustomerIdFromResourceName)
        .filter((id): id is string => Boolean(id));
    },
    async getCustomer(session, googleCustomerId) {
      const rows: JsonObject[] = [];
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.customer,
      )) {
        rows.push(row);
        break;
      }
      const row = rows[0];
      if (!row) {
        throw new GoogleAdsProviderError({
          code: "ACCESS_LOST",
          message: "Google Ads request failed.",
          accessLost: true,
        });
      }
      return accountFromCustomerRow(row, session.loginCustomerId);
    },
    async getCustomerHierarchy(session, managerCustomerId) {
      const accounts: GoogleAdsAccount[] = [];
      const seen = new Set<string>();
      for await (const row of searchPages(
        { ...session, loginCustomerId: managerCustomerId },
        managerCustomerId,
        googleAdsQueries.customerClients,
      )) {
        const client = asObject(row.customerClient ?? row);
        const id =
          asGoogleIdString(client.id) ||
          parseCustomerIdFromResourceName(
            typeof client.clientCustomer === "string"
              ? client.clientCustomer
              : "",
          ) ||
          "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        accounts.push({
          googleCustomerId: id,
          descriptiveName:
            typeof client.descriptiveName === "string"
              ? client.descriptiveName
              : id,
          currencyCode:
            typeof client.currencyCode === "string"
              ? client.currencyCode
              : null,
          timeZone:
            typeof client.timeZone === "string" ? client.timeZone : null,
          isManager: client.manager === true,
          status: typeof client.status === "string" ? client.status : "UNKNOWN",
          loginCustomerId: id === managerCustomerId ? null : managerCustomerId,
        });
      }
      return accounts;
    },
    async *syncStandardAdDestinations(session, googleCustomerId) {
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.standardAdDestinations,
      )) {
        const campaign = asObject(row.campaign);
        const adGroup = asObject(row.adGroup);
        const adGroupAd = asObject(row.adGroupAd);
        const ad = asObject(adGroupAd.ad);
        yield {
          campaignId: asGoogleIdString(campaign.id),
          campaignName: typeof campaign.name === "string" ? campaign.name : "",
          campaignStatus:
            typeof campaign.status === "string" ? campaign.status : "UNKNOWN",
          advertisingChannelType:
            typeof campaign.advertisingChannelType === "string"
              ? campaign.advertisingChannelType
              : null,
          adGroupId: asGoogleIdString(adGroup.id),
          adGroupName: typeof adGroup.name === "string" ? adGroup.name : "",
          adGroupStatus:
            typeof adGroup.status === "string" ? adGroup.status : "UNKNOWN",
          adId: asGoogleIdString(ad.id ?? nested(adGroupAd, "ad.id")),
          adStatus:
            typeof adGroupAd.status === "string" ? adGroupAd.status : "UNKNOWN",
          adPrimaryStatus:
            typeof adGroupAd.primaryStatus === "string"
              ? adGroupAd.primaryStatus
              : null,
          adType: typeof ad.type === "string" ? ad.type : null,
          finalUrls: asStringArray(ad.finalUrls),
          finalMobileUrls: asStringArray(ad.finalMobileUrls),
        } satisfies GoogleAdsStandardAdDestination;
      }
    },
    async *syncPerformanceMaxDestinations(session, googleCustomerId) {
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.performanceMaxDestinations,
      )) {
        const campaign = asObject(row.campaign);
        const assetGroup = asObject(row.assetGroup);
        yield {
          campaignId: asGoogleIdString(campaign.id),
          campaignName: typeof campaign.name === "string" ? campaign.name : "",
          campaignStatus:
            typeof campaign.status === "string" ? campaign.status : "UNKNOWN",
          advertisingChannelType:
            typeof campaign.advertisingChannelType === "string"
              ? campaign.advertisingChannelType
              : null,
          assetGroupId: asGoogleIdString(assetGroup.id),
          assetGroupName:
            typeof assetGroup.name === "string" ? assetGroup.name : "",
          assetGroupStatus:
            typeof assetGroup.status === "string"
              ? assetGroup.status
              : "UNKNOWN",
          assetGroupPrimaryStatus:
            typeof assetGroup.primaryStatus === "string"
              ? assetGroup.primaryStatus
              : null,
          finalUrls: asStringArray(assetGroup.finalUrls),
          finalMobileUrls: asStringArray(assetGroup.finalMobileUrls),
        } satisfies GoogleAdsPerformanceMaxDestination;
      }
    },
    async *syncObservedLandingPages(session, googleCustomerId, lookback) {
      const config = getGoogleAdsConfig();
      let yielded = 0;
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.observedLandingPages(
          lookback.fromDate,
          lookback.toDate,
        ),
      )) {
        const view = asObject(row.expandedLandingPageView);
        const campaign = asObject(row.campaign);
        const segments = asObject(row.segments);
        const url =
          typeof view.expandedFinalUrl === "string"
            ? view.expandedFinalUrl
            : "";
        if (!url) continue;
        yielded += 1;
        if (yielded > config.observedUrlCap) return;
        yield {
          expandedFinalUrl: url,
          landingPageSource:
            typeof segments.landingPageSource === "string"
              ? segments.landingPageSource
              : null,
          campaignId: asGoogleIdString(campaign.id),
          campaignName: typeof campaign.name === "string" ? campaign.name : "",
          campaignStatus:
            typeof campaign.status === "string" ? campaign.status : "UNKNOWN",
        } satisfies GoogleAdsObservedLandingPage;
      }
    },
    async getAdHourlyMetrics(session, googleCustomerId, input) {
      const config = getGoogleAdsConfig();
      const rows: GoogleAdsHourlySourceMetric[] = [];
      for (const ids of chunkIds(input.adIds, config.impactIdChunkSize)) {
        if (ids.length === 0) continue;
        for await (const row of searchPages(
          session,
          googleCustomerId,
          googleAdsQueries.adHourlyMetrics(input.fromDate, input.toDate, ids),
        )) {
          const ad = asObject(asObject(row.adGroupAd).ad);
          const segments = asObject(row.segments);
          const metrics = metricTriple(row);
          const sourceEntityId = asGoogleIdString(ad.id);
          if (!sourceEntityId || !asDate(segments.date)) continue;
          rows.push({
            sourceType: "AD_GROUP_AD",
            sourceEntityId,
            date: asDate(segments.date),
            hour: asHour(segments.hour),
            ...metrics,
          });
        }
      }
      return rows;
    },
    async getAssetGroupHourlyMetrics(session, googleCustomerId, input) {
      const config = getGoogleAdsConfig();
      const rows: GoogleAdsHourlySourceMetric[] = [];
      for (const ids of chunkIds(
        input.assetGroupIds,
        config.impactIdChunkSize,
      )) {
        if (ids.length === 0) continue;
        for await (const row of searchPages(
          session,
          googleCustomerId,
          googleAdsQueries.assetGroupHourlyMetrics(
            input.fromDate,
            input.toDate,
            ids,
          ),
        )) {
          const assetGroup = asObject(row.assetGroup);
          const segments = asObject(row.segments);
          const metrics = metricTriple(row);
          const sourceEntityId = asGoogleIdString(assetGroup.id);
          if (!sourceEntityId || !asDate(segments.date)) continue;
          rows.push({
            sourceType: "ASSET_GROUP",
            sourceEntityId,
            date: asDate(segments.date),
            hour: asHour(segments.hour),
            ...metrics,
          });
        }
      }
      return rows;
    },
    async getLandingPageDailyMetrics(session, googleCustomerId, range) {
      const rows: GoogleAdsDailyLandingPageMetric[] = [];
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.landingPageDailyMetrics(range.fromDate, range.toDate),
      )) {
        const view = asObject(row.landingPageView);
        const segments = asObject(row.segments);
        const url =
          typeof view.unexpandedFinalUrl === "string"
            ? view.unexpandedFinalUrl
            : "";
        if (!url || !asDate(segments.date)) continue;
        rows.push({
          kind: "UNEXPANDED",
          url,
          date: asDate(segments.date),
          ...metricTriple(row),
        });
      }
      return rows;
    },
    async getExpandedLandingPageDailyMetrics(session, googleCustomerId, range) {
      const rows: GoogleAdsDailyLandingPageMetric[] = [];
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.expandedLandingPageDailyMetrics(
          range.fromDate,
          range.toDate,
        ),
      )) {
        const view = asObject(row.expandedLandingPageView);
        const segments = asObject(row.segments);
        const url =
          typeof view.expandedFinalUrl === "string"
            ? view.expandedFinalUrl
            : "";
        if (!url || !asDate(segments.date)) continue;
        rows.push({
          kind: "EXPANDED",
          url,
          date: asDate(segments.date),
          ...metricTriple(row),
        });
      }
      return rows;
    },
    async listConversionActions(session, googleCustomerId) {
      const rows: GoogleAdsConversionActionRow[] = [];
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.conversionActions,
      )) {
        const action = asObject(row.conversionAction);
        const id = asGoogleIdString(action.id);
        if (!id) continue;
        rows.push({
          conversionActionId: id,
          name: typeof action.name === "string" ? action.name : id,
          status: typeof action.status === "string" ? action.status : "UNKNOWN",
          type: typeof action.type === "string" ? action.type : "UNKNOWN",
          category:
            typeof action.category === "string" ? action.category : null,
          countingType:
            typeof action.countingType === "string"
              ? action.countingType
              : null,
          clickThroughLookbackWindowDays:
            typeof action.clickThroughLookbackWindowDays === "number"
              ? action.clickThroughLookbackWindowDays
              : typeof action.clickThroughLookbackWindowDays === "string" &&
                  /^-?\d+$/.test(action.clickThroughLookbackWindowDays)
                ? Number(action.clickThroughLookbackWindowDays)
                : null,
        });
      }
      return rows;
    },
    async getCustomerDailyPerformance(session, googleCustomerId, range) {
      const rows: GoogleAdsCustomerDailyPerformanceRow[] = [];
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.customerDailyPerformance(range.fromDate, range.toDate),
      )) {
        const segments = asObject(row.segments);
        const date = asDate(segments.date);
        if (!date) continue;
        rows.push({ date, ...metricTriple(row) });
      }
      return rows;
    },
    async getCampaignDailyPerformance(session, googleCustomerId, range) {
      const rows: GoogleAdsCampaignDailyPerformanceRow[] = [];
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.campaignDailyPerformance(range.fromDate, range.toDate),
      )) {
        const campaign = asObject(row.campaign);
        const segments = asObject(row.segments);
        const campaignId = asGoogleIdString(campaign.id);
        const date = asDate(segments.date);
        if (!campaignId || !date) continue;
        rows.push({
          date,
          campaignId,
          campaignName:
            typeof campaign.name === "string" ? campaign.name : campaignId,
          campaignStatus:
            typeof campaign.status === "string" ? campaign.status : "UNKNOWN",
          advertisingChannelType:
            typeof campaign.advertisingChannelType === "string"
              ? campaign.advertisingChannelType
              : null,
          ...metricTriple(row),
        });
      }
      return rows;
    },
    async getClickViews(session, googleCustomerId, input) {
      const rows: GoogleAdsClickViewRow[] = [];
      if (input.gclids.length === 0) return rows;
      for await (const row of searchPages(
        session,
        googleCustomerId,
        googleAdsQueries.clickViews(input.date, input.gclids),
      )) {
        const clickView = asObject(row.clickView);
        const campaign = asObject(row.campaign);
        const adGroup = asObject(row.adGroup);
        const keywordInfo = asObject(clickView.keywordInfo);
        const segments = asObject(row.segments);
        const gclid =
          typeof clickView.gclid === "string" ? clickView.gclid : "";
        const date = asDate(segments.date) || input.date;
        if (!gclid) continue;
        const campaignId = asGoogleIdString(campaign.id) || null;
        rows.push({
          date,
          gclid,
          campaignId,
          campaignName:
            typeof campaign.name === "string" ? campaign.name : null,
          campaignStatus:
            typeof campaign.status === "string" ? campaign.status : null,
          advertisingChannelType:
            typeof campaign.advertisingChannelType === "string"
              ? campaign.advertisingChannelType
              : null,
          adGroupId: asGoogleIdString(adGroup.id) || null,
          adGroupName: typeof adGroup.name === "string" ? adGroup.name : null,
          adId: lastResourceId(clickView.adGroupAd),
          keywordCriterionId: lastResourceId(clickView.keyword),
          keywordText:
            typeof keywordInfo.text === "string" ? keywordInfo.text : null,
          keywordMatchType:
            typeof keywordInfo.matchType === "string"
              ? keywordInfo.matchType
              : null,
        });
      }
      return rows;
    },
  };
}

function lastResourceId(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const tail = value.split("/").pop() ?? "";
  const id = tail.includes("~") ? tail.split("~").pop() : tail;
  return id && /^\d+$/.test(id) ? id : null;
}

function tokenSetFromJson(json: JsonObject): GoogleAdsOAuthTokenSet {
  return {
    accessToken: typeof json.access_token === "string" ? json.access_token : "",
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
    email: null,
    scope: typeof json.scope === "string" ? json.scope : null,
  };
}

export function createLiveGoogleAdsAuthClient(): GoogleAdsAuthClient {
  return {
    createAuthorizationUrl(input) {
      const url = new URL(googleAdsAuthUrl);
      url.searchParams.set("client_id", input.clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", input.scopes.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set(
        "include_granted_scopes",
        input.includeGrantedScopes ? "true" : "false",
      );
      url.searchParams.set("state", input.state);
      return url.toString();
    },
    async exchangeAuthorizationCode(input) {
      const body = new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      });
      const { json } = await googleFetch(googleAdsTokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const tokens = tokenSetFromJson(json);
      if (!tokens.accessToken) {
        throw new GoogleAdsProviderError({
          code: "AUTH_FAILURE",
          message: "Google Ads request failed.",
          authFailure: true,
        });
      }
      return tokens;
    },
    async refreshAccessToken(input) {
      const body = new URLSearchParams({
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "refresh_token",
      });
      try {
        const { json } = await googleFetch(googleAdsTokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const accessToken =
          typeof json.access_token === "string" ? json.access_token : "";
        if (!accessToken) {
          throw new GoogleAdsProviderError({
            code: "AUTH_FAILURE",
            message: "Google Ads request failed.",
            authFailure: true,
          });
        }
        return {
          accessToken,
          expiresIn:
            typeof json.expires_in === "number" ? json.expires_in : null,
        };
      } catch (error) {
        if (error instanceof GoogleAdsProviderError) throw error;
        throw new GoogleAdsProviderError({
          code: "AUTH_FAILURE",
          message: "Google Ads request failed.",
          authFailure: true,
        });
      }
    },
    async revokeToken(token) {
      try {
        await fetch(googleAdsRevokeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch {
        // Best-effort revoke. Disconnect still proceeds.
      }
    },
  };
}
