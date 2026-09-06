import { config } from "dotenv";
import { database } from "@/server/database";
import { decryptClickId } from "@/server/tracking/click-crypto";
import { resetFakeGoogleAdsWorld } from "@/server/google-ads/fake-provider";
import { executeGoogleAdsAnalyticsSync } from "@/server/google-ads/analytics-sync";
import {
  ensureLeadClickResolution,
  executeGoogleAdsClickResolution,
} from "@/server/google-ads/click-resolution";
import { todayInTimeZone } from "@/server/revenue-analytics/dates";

if (!process.env.DATABASE_URL) {
  config({ path: process.env.E2E_ENV_FILE ?? ".env" });
}

type Mode = "complete" | "partial" | "unresolved" | "resolved";

async function main() {
  const organizationSlug = process.argv[2];
  const mode = (process.argv[3] as Mode | undefined) ?? "complete";
  if (!organizationSlug) {
    throw new Error(
      "Usage: apply-revenue-analytics.ts <organizationSlug> [complete|partial|unresolved|resolved]",
    );
  }
  const organization = await database.organization.findUnique({
    where: { slug: organizationSlug },
  });
  if (!organization) throw new Error("Organization not found.");
  const customer = await database.googleAdsCustomer.findFirst({
    where: {
      organizationId: organization.id,
      googleCustomerId: "2222222222",
    },
  });
  if (!customer) throw new Error("Google Ads customer not found.");
  const timeZone = customer.timeZone || "Europe/Amsterdam";
  const today = todayInTimeZone(new Date(), timeZone);
  const leads = await database.lead.findMany({
    where: { organizationId: organization.id },
    include: {
      attribution: { include: { primaryTouch: true } },
      outcome: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const clickViews =
    mode === "unresolved"
      ? []
      : leads.flatMap((lead) => {
          const encrypted = lead.attribution?.primaryTouch?.encryptedGclid;
          if (!encrypted) return [];
          return [
            {
              date: today,
              gclid: decryptClickId(encrypted),
              campaignId: "100",
              campaignName: "Airco Amsterdam",
              campaignStatus: "ENABLED",
              advertisingChannelType: "SEARCH",
              adGroupId: "200",
              adGroupName: "Daikin airco",
              adId: "1001",
              keywordCriterionId: null,
              keywordText: null,
              keywordMatchType: null,
            },
          ];
        });
  resetFakeGoogleAdsWorld({
    customerDaily: {
      "2222222222": [
        {
          date: today,
          costMicros: 1_000_000_000n,
          clicks: 100n,
          impressions: 1000n,
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
          costMicros: 1_000_000_000n,
          clicks: 100n,
          impressions: 1000n,
        },
        {
          date: today,
          campaignId: "104",
          campaignName: "Removed campaign",
          campaignStatus: "REMOVED",
          advertisingChannelType: "SEARCH",
          costMicros: 0n,
          clicks: 0n,
          impressions: 0n,
        },
      ],
    },
    clickViews: { "2222222222": clickViews },
  });
  await executeGoogleAdsAnalyticsSync({
    googleAdsCustomerId: customer.id,
    organizationId: organization.id,
    kind: "BACKFILL",
    days: 30,
  });
  for (const lead of leads) {
    await ensureLeadClickResolution({
      leadId: lead.id,
      organizationId: organization.id,
    });
  }
  await executeGoogleAdsClickResolution({
    organizationId: organization.id,
    googleAdsCustomerId: customer.id,
  });

  const now = new Date();
  async function setOutcome(
    lead: (typeof leads)[number] | undefined,
    status: "WON" | "LOST",
    revenueMinor: bigint | null,
  ) {
    if (!lead?.outcome) return;
    await database.leadOutcome.update({
      where: { id: lead.outcome.id },
      data: {
        status,
        statusChangedAt: now,
        wonAt: status === "WON" ? now : null,
        lostAt: status === "LOST" ? now : null,
        revenueAmountMinor: revenueMinor,
        revenueCurrencyCode: revenueMinor === null ? null : "EUR",
        revenueSource: revenueMinor === null ? null : "MANUAL",
        revenueUpdatedAt: revenueMinor === null ? null : now,
        version: { increment: 1 },
      },
    });
  }
  if (mode === "complete" || mode === "resolved" || mode === "unresolved") {
    await setOutcome(leads[0], "WON", 300_000n);
    await setOutcome(leads[1], "LOST", null);
    await setOutcome(leads[2], "WON", 200_000n);
  }
  if (mode === "partial") {
    await setOutcome(leads[0], "WON", 300_000n);
    await setOutcome(leads[1], "WON", null);
  }
  process.stdout.write(
    `E2E_LEAD_IDS=${leads.map((lead) => lead.id).join(",")}\n`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await database.$disconnect();
  });
