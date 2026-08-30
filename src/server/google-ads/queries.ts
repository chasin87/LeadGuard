import { getGoogleAdsConfig } from "@/server/google-ads/config";

export const googleAdsQueries = {
  customer: `
SELECT
  customer.id,
  customer.descriptive_name,
  customer.currency_code,
  customer.time_zone,
  customer.manager,
  customer.status
FROM customer
LIMIT 1
`.trim(),
  customerClients: `
SELECT
  customer_client.id,
  customer_client.client_customer,
  customer_client.descriptive_name,
  customer_client.currency_code,
  customer_client.time_zone,
  customer_client.manager,
  customer_client.level,
  customer_client.status
FROM customer_client
WHERE customer_client.level <= ${getGoogleAdsConfig().customerClientMaxLevel}
  AND customer_client.status != 'CANCELLED'
`.trim(),
  standardAdDestinations: `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  ad_group.id,
  ad_group.name,
  ad_group.status,
  ad_group_ad.ad.id,
  ad_group_ad.status,
  ad_group_ad.primary_status,
  ad_group_ad.ad.type,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.final_mobile_urls
FROM ad_group_ad
WHERE ad_group_ad.status != 'REMOVED'
  AND campaign.status != 'REMOVED'
  AND ad_group.status != 'REMOVED'
`.trim(),
  performanceMaxDestinations: `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  asset_group.id,
  asset_group.name,
  asset_group.status,
  asset_group.primary_status,
  asset_group.final_urls,
  asset_group.final_mobile_urls
FROM asset_group
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND asset_group.status != 'REMOVED'
  AND campaign.status != 'REMOVED'
`.trim(),
  observedLandingPages(fromDate: string, toDate: string): string {
    return `
SELECT
  expanded_landing_page_view.expanded_final_url,
  segments.landing_page_source,
  segments.date,
  campaign.id,
  campaign.name,
  campaign.status
FROM expanded_landing_page_view
WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
`.trim();
  },
  adHourlyMetrics(fromDate: string, toDate: string, adIds: string[]): string {
    return `
SELECT
  ad_group_ad.ad.id,
  segments.date,
  segments.hour,
  metrics.clicks,
  metrics.cost_micros,
  metrics.impressions
FROM ad_group_ad
WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
  AND ad_group_ad.ad.id IN (${adIds.join(", ")})
`.trim();
  },
  assetGroupHourlyMetrics(
    fromDate: string,
    toDate: string,
    assetGroupIds: string[],
  ): string {
    return `
SELECT
  asset_group.id,
  segments.date,
  segments.hour,
  metrics.clicks,
  metrics.cost_micros,
  metrics.impressions
FROM asset_group
WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
  AND asset_group.id IN (${assetGroupIds.join(", ")})
`.trim();
  },
  landingPageDailyMetrics(fromDate: string, toDate: string): string {
    return `
SELECT
  landing_page_view.unexpanded_final_url,
  segments.date,
  metrics.clicks,
  metrics.cost_micros,
  metrics.impressions
FROM landing_page_view
WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
`.trim();
  },
  expandedLandingPageDailyMetrics(fromDate: string, toDate: string): string {
    return `
SELECT
  expanded_landing_page_view.expanded_final_url,
  segments.date,
  metrics.clicks,
  metrics.cost_micros,
  metrics.impressions
FROM expanded_landing_page_view
WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
`.trim();
  },
} as const;
