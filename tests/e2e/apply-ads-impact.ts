import { config } from "dotenv";
import { database } from "@/server/database";
import { executeGoogleAdsImpactJob } from "@/server/google-ads/impact/refresh";
import { zonedLocalToUtc } from "@/server/google-ads/impact/timezone";
import { resetFakeGoogleAdsWorld } from "@/server/google-ads/fake-provider";

config({ path: ".env" });

async function main() {
  const incidentId = process.argv[2];
  const mode = process.argv[3] ?? "hourly";
  if (!incidentId) {
    throw new Error(
      "Usage: apply-ads-impact.ts <incidentId> [hourly|daily|none]",
    );
  }

  resetFakeGoogleAdsWorld(
    mode === "none"
      ? {
          failMetricsFor: ["2222222222"],
        }
      : mode === "daily"
        ? { hourlyAdMetrics: {} }
        : {},
  );

  const startedAt = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 15);
  const resolvedAt = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 15, 45);
  await database.incident.update({
    where: { id: incidentId },
    data: {
      startedAt,
      detectedAt: zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 20),
      resolvedAt,
      status: "RESOLVED",
    },
  });
  await executeGoogleAdsImpactJob({ incidentId, reason: "finalize" });
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
