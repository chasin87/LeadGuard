import { database } from "@/server/database";

export async function getGoogleAdsContextForMonitor(monitorId: string) {
  const config = await database.adDestinationConfig.findUnique({
    where: { monitorId },
    include: {
      target: {
        include: {
          references: {
            where: { sourceActive: true },
            orderBy: { campaignName: "asc" },
          },
        },
      },
    },
  });
  if (!config) return null;
  const campaigns = [
    ...new Set(config.target.references.map((item) => item.campaignName)),
  ];
  return {
    targetId: config.target.id,
    sourceUrl: config.target.sourceUrl,
    monitoringUrl: config.target.monitoringUrl,
    normalizedUrl: config.target.normalizedUrl,
    enabledReferenceCount: config.target.references.length,
    campaignNames: campaigns.slice(0, 3),
    additionalCampaignCount: Math.max(0, campaigns.length - 3),
    references: config.target.references,
  };
}
