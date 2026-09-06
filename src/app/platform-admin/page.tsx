import { requirePlatformPermission } from "@/server/platform-admin/require";
import { getPlatformOverview } from "@/server/platform-admin/overview";
import { getOperationsHealth } from "@/server/platform-admin/health";
import { PlatformBadge } from "@/components/platform-badge";

export const metadata = { title: "Platform overview" };

export default async function PlatformOverviewPage() {
  await requirePlatformPermission("platform:overview");
  const [overview, health] = await Promise.all([
    getPlatformOverview(),
    getOperationsHealth(),
  ]);
  const cards = [
    ["Organizations", overview.organizations],
    ["Active subscriptions", overview.subscriptions.active],
    ["Trials", overview.subscriptions.trials],
    ["Past due", overview.subscriptions.pastDue],
    ["Suspended", overview.subscriptions.suspended],
    ["Websites", overview.websites],
    ["Monitors", overview.monitors],
    ["Open incidents", overview.openIncidents],
    ["Leads today", overview.leadsToday],
    ["Won leads today", overview.wonLeadsToday],
    ["Conversion feedback errors", overview.conversionFeedbackErrors],
    ["Unmatched outcome orgs", overview.unmatchedOutcomeOrganizations],
    ["Queue pending", overview.queue.pending],
    ["Queue failed", overview.queue.failed],
  ] as const;
  return (
    <div>
      <h1 className="text-2xl font-bold">Overview</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Operational metrics. Revenue known is listed by currency, not summed.
      </p>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <article
            key={label}
            className="rounded-xl border border-[var(--border)] bg-white p-4"
          >
            <p className="text-xs text-[var(--muted)]">{label}</p>
            <p
              className="mt-2 text-2xl font-bold"
              data-testid={`metric-${label}`}
            >
              {value}
            </p>
          </article>
        ))}
      </section>
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">Revenue known currencies</h2>
        <p className="mt-2 text-sm">
          {overview.revenueKnownCurrencies.length
            ? overview.revenueKnownCurrencies.join(", ")
            : "No known revenue"}
        </p>
      </section>
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold">System health</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <PlatformBadge tone="ok">Web app configured</PlatformBadge>
          <PlatformBadge tone="ok">Database configured</PlatformBadge>
          <PlatformBadge
            tone={
              health.scheduler.status === "HEALTHY"
                ? "ok"
                : health.scheduler.status === "DEGRADED"
                  ? "warn"
                  : "danger"
            }
          >
            Scheduler {health.scheduler.status}
          </PlatformBadge>
          <PlatformBadge tone={health.stripe.configured ? "ok" : "warn"}>
            Stripe {health.stripe.configured ? "configured" : "not live"}
          </PlatformBadge>
          <PlatformBadge tone={health.email.configured ? "ok" : "warn"}>
            Email {health.email.configured ? "configured" : "unconfigured"}
          </PlatformBadge>
          <PlatformBadge tone={health.google.configured ? "ok" : "warn"}>
            Google {health.google.configured ? "configured" : "unconfigured"}
          </PlatformBadge>
          <PlatformBadge tone="neutral">
            Storage {health.storage.driver}
          </PlatformBadge>
        </div>
      </section>
    </div>
  );
}
