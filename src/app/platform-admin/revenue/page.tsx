import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { hasPlatformPermission } from "@/server/platform-admin/permissions";
import { database } from "@/server/database";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Platform revenue" };

export default async function PlatformRevenuePage() {
  const actor = await requirePlatformPermission("platform:revenue:summary");
  const exact = hasPlatformPermission(actor.role, "platform:revenue:read");
  const [won, spend, analytics] = await Promise.all([
    database.leadOutcome.groupBy({
      by: ["revenueCurrencyCode"],
      where: {
        status: "WON",
        revenueCurrencyCode: { not: null },
        revenueAmountMinor: { not: null },
      },
      _count: { _all: true },
      _sum: { revenueAmountMinor: true },
    }),
    database.googleAdsPerformanceDaily.groupBy({
      by: ["currencyCode"],
      _sum: { costMicros: true },
    }),
    database.googleAdsAnalyticsConfig.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold">Revenue</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Known revenue and Google spend are grouped by currency. Totals are never
        mixed.
      </p>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Known revenue</h2>
        {won.length === 0 ? (
          <p className="mt-2">No known revenue</p>
        ) : (
          won.map((row) => (
            <p key={row.revenueCurrencyCode}>
              {row.revenueCurrencyCode}: {row._count._all} won
              {exact && row._sum.revenueAmountMinor != null
                ? ` · ${formatMoney(row._sum.revenueAmountMinor, row.revenueCurrencyCode ?? "EUR")}`
                : ""}
            </p>
          ))
        )}
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Google spend</h2>
        {spend.map((row) => (
          <p key={row.currencyCode}>
            {row.currencyCode}:{" "}
            {exact ? String(row._sum.costMicros ?? 0) : "hidden"} micros
          </p>
        ))}
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Analytics configs</h2>
        {analytics.map((row) => (
          <p key={row.status}>
            {row.status}: {row._count._all}
          </p>
        ))}
        <p className="mt-2">
          Open an organization for ROAS status and freshness.{" "}
          <Link className="font-semibold" href="/platform-admin/organizations">
            Organizations
          </Link>
        </p>
      </section>
    </div>
  );
}
