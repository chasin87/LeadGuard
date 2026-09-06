import Link from "next/link";
import { AnalyticsRefreshButtons } from "@/components/analytics-refresh-buttons";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getRevenueAnalyticsDashboard } from "@/server/revenue-analytics/service";
import type {
  AnalyticsMetricStatus,
  CostMetric,
  CountMetric,
  MoneyMetric,
  RatioMetric,
} from "@/server/revenue-analytics/types";

export const metadata = { title: "Revenue analytics" };

function badge(status: AnalyticsMetricStatus) {
  if (status === "COMPLETE") return "Complete";
  if (status === "PARTIAL_REVENUE" || status === "PARTIAL_ATTRIBUTION") {
    return "Partial";
  }
  if (status === "STALE_SPEND") return "Stale";
  if (status === "NO_SPEND") return "No spend";
  return "Unavailable";
}

function formatAsOf(value: Date | null) {
  if (!value) return "unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function moneyText(metric: MoneyMetric | CostMetric) {
  if (metric.formatted) return metric.formatted;
  if (metric.status === "NO_SPEND") return "No Google Ads spend reported";
  return "unavailable";
}

function countText(metric: CountMetric) {
  return String(metric.value);
}

function ratioText(metric: RatioMetric) {
  return metric.formatted ?? "unavailable";
}

function dash(metric: CostMetric) {
  return metric.formatted ?? "—";
}

export default async function RevenueAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    customer?: string;
    website?: string | string[];
    websites?: string;
    sort?: string;
  }>;
}) {
  const { organizationSlug } = await params;
  const filters = await searchParams;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );
  const range =
    filters.range === "7" ||
    filters.range === "30" ||
    filters.range === "90" ||
    filters.range === "custom"
      ? filters.range
      : "30";
  const websiteIds = Array.isArray(filters.website)
    ? filters.website
    : filters.website
      ? [filters.website]
      : filters.websites
        ? filters.websites.split(",")
        : undefined;
  const dashboard = await getRevenueAnalyticsDashboard(
    user.id,
    organizationSlug,
    {
      range,
      from: filters.from,
      to: filters.to,
      customerId: filters.customer,
      websiteIds,
      sort:
        filters.sort === "revenue" ||
        filters.sort === "roas" ||
        filters.sort === "leads"
          ? filters.sort
          : "spend",
    },
  );
  const analytics = dashboard.analytics;
  const account = dashboard.account;

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
      <p className="mt-2 max-w-3xl text-[var(--muted)]">
        Acquisition-cohort Real ROAS compares Google Ads reported spend with
        LeadGuard realized revenue from leads acquired in the same period.
      </p>

      {dashboard.empty ? (
        <section
          className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6"
          data-testid="analytics-empty"
        >
          <p>
            Connect a Website to a Google Ads advertiser account to calculate
            revenue attribution and ROAS.
          </p>
          <p className="mt-4">
            <Link
              className="font-semibold text-[#19d0a2] hover:underline"
              href={`/app/${organizationSlug}/integrations/google-ads/analytics`}
            >
              Set up revenue analytics
            </Link>
          </p>
        </section>
      ) : null}

      {dashboard.reauthRequired && !dashboard.empty ? (
        <p
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
          data-testid="analytics-stale"
        >
          Google Ads data is stale — reconnect required.
        </p>
      ) : null}

      {account && analytics ? (
        <>
          <form className="mt-8 flex flex-wrap gap-3" method="get">
            <input name="customer" type="hidden" value={account.customerId} />
            <label className="text-sm font-semibold">
              Range
              <select
                className="ml-2 rounded-xl border border-[var(--border)] px-3 py-2"
                defaultValue={range}
                name="range"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {dashboard.accounts.length > 1 ? (
              <label className="text-sm font-semibold">
                Account
                <select
                  className="ml-2 rounded-xl border border-[var(--border)] px-3 py-2"
                  defaultValue={account.customerId}
                  name="customer"
                >
                  {dashboard.accounts.map((item) => (
                    <option key={item.customerId} value={item.customerId}>
                      {item.descriptiveName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {account.websites.length > 1
              ? account.websites.map((website) => (
                  <label className="text-sm" key={website.id}>
                    <input
                      defaultChecked={dashboard.selectedWebsiteIds.includes(
                        website.id,
                      )}
                      name="website"
                      type="checkbox"
                      value={website.id}
                    />{" "}
                    {website.name}
                  </label>
                ))
              : null}
            <button
              className="rounded-xl bg-[#172033] px-4 py-2 text-sm font-semibold text-white"
              type="submit"
            >
              Apply
            </button>
          </form>

          <p
            className="mt-4 text-sm text-[var(--muted)]"
            data-testid="data-as-of"
          >
            Data as of · Google Ads spend:{" "}
            {formatAsOf(analytics.freshness.spendAsOf)} · Lead outcomes: live
          </p>
          {analytics.maturity.stillMaturing && analytics.maturity.label ? (
            <p className="mt-2 text-sm text-amber-800">
              Cohort still maturing. {analytics.maturity.label}
            </p>
          ) : null}
          {analytics.spendScope === "WEBSITE_FILTER_EXCLUDED" ? (
            <p className="mt-2 text-sm text-amber-800">
              Spend is Google Ads reported account spend and is not allocated to
              the website filter.
            </p>
          ) : null}

          {canManage ? (
            <div className="mt-4">
              <AnalyticsRefreshButtons
                googleAdsCustomerId={account.customerId}
                organizationSlug={organizationSlug}
              />
            </div>
          ) : null}

          <section className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Google Ads Spend"
              testId="kpi-spend"
              title="Google Ads reported spend from metrics.cost_micros. Not spend-at-risk."
              value={moneyText(analytics.spend)}
              status={analytics.spend.status}
            />
            <KpiCard
              label="Google Ads Clicks"
              testId="kpi-clicks"
              value={countText(analytics.clicks)}
              status={analytics.clicks.status}
            />
            <KpiCard
              label="Leads"
              testId="kpi-leads"
              value={countText(analytics.leads)}
              status={analytics.leads.status}
            />
            <KpiCard
              label="Won Leads"
              testId="kpi-won"
              value={countText(analytics.won)}
              status={analytics.won.status}
            />
            <KpiCard
              label="LeadGuard realized revenue"
              testId="kpi-revenue"
              title="Revenue is grouped by the date the lead was acquired, even if the deal was won later."
              value={
                analytics.revenueByCurrency.length > 1
                  ? analytics.revenueByCurrency
                      .map((row) => row.formatted)
                      .join(" · ")
                  : moneyText(analytics.realizedRevenue)
              }
              status={analytics.realizedRevenue.status}
            />
            <KpiCard
              label={analytics.realRoas.label}
              testId="kpi-roas"
              title="Real ROAS compares Google Ads reported spend with realized revenue from LeadGuard leads acquired from the same Google Ads cohort."
              value={ratioText(analytics.realRoas)}
              status={analytics.realRoas.status}
            />
          </section>

          <section className="mt-4 grid gap-4 md:grid-cols-3">
            <KpiCard
              label="Cost / Lead"
              testId="kpi-cpl"
              value={dash(analytics.costPerLead)}
              status={analytics.costPerLead.status}
            />
            <KpiCard
              label="Cost / Won Lead"
              testId="kpi-cpw"
              value={dash(analytics.costPerWon)}
              status={analytics.costPerWon.status}
            />
            <KpiCard
              label="Win Rate"
              testId="kpi-win-rate"
              title="WON / (WON + LOST)"
              value={analytics.winRate.formatted ?? "—"}
              status={analytics.winRate.status}
            />
          </section>

          <section className="mt-8 grid gap-4 lg:grid-cols-3">
            <article
              className="rounded-2xl border border-[var(--border)] bg-white p-5"
              data-testid="revenue-completeness"
            >
              <h2 className="text-sm font-semibold text-[var(--muted)]">
                Revenue completeness
              </h2>
              <p className="mt-2 text-2xl font-bold">
                {analytics.revenueCompleteness.knownWon} /{" "}
                {analytics.revenueCompleteness.totalWon} won leads
              </p>
              <p className="mt-1 text-sm">
                {analytics.revenueCompleteness.percent ?? 0}%
              </p>
            </article>
            <article
              className="rounded-2xl border border-[var(--border)] bg-white p-5"
              data-testid="campaign-coverage"
              title="Campaign attribution is only used when LeadGuard can reliably resolve the original Google Ads campaign. Unresolved revenue is not distributed across campaigns."
            >
              <h2 className="text-sm font-semibold text-[var(--muted)]">
                Campaign attribution
              </h2>
              <p className="mt-2 text-2xl font-bold">
                {analytics.campaignAttributionCoverage.percent ?? 0}% resolved
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {100 - (analytics.campaignAttributionCoverage.percent ?? 0)}% of
                Google Ads-attributed leads could not be reliably mapped to a
                campaign.
              </p>
            </article>
            <article
              className="rounded-2xl border border-[var(--border)] bg-white p-5"
              data-testid="google-feedback-health"
              title="Google conversion feedback status does not change LeadGuard's realized revenue."
            >
              <h2 className="text-sm font-semibold text-[var(--muted)]">
                Google feedback
              </h2>
              <p className="mt-2 text-sm">
                Succeeded {analytics.feedback.succeeded}
              </p>
              <p className="text-sm">
                Processing {analytics.feedback.processing}
              </p>
              <p className="text-sm">
                Needs attention {analytics.feedback.needsAttention}
              </p>
            </article>
          </section>

          <TrendChart
            points={analytics.acquisitionTrend}
            title="Acquisition cohort"
            subtitle="Revenue is grouped by acquisition date, not won date."
            testId="cohort-chart"
          />
          <TrendChart
            points={analytics.wonByOutcomeDate.map((row) => ({
              date: row.date,
              spendMinor: null,
              spendFormatted: null,
              revenueMinor: row.revenueMinor,
              revenueFormatted: row.revenueFormatted,
            }))}
            title="Won revenue by outcome date"
            subtitle="Secondary view. Not used as the Real ROAS numerator."
            testId="outcome-chart"
            revenueOnly
          />

          <CampaignTable
            organizationSlug={organizationSlug}
            rows={analytics.campaigns}
            unresolved={analytics.unresolved}
            sort={filters.sort ?? "spend"}
            customerId={account.customerId}
            range={range}
          />
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  status,
  testId,
  title,
}: {
  label: string;
  value: string;
  status: AnalyticsMetricStatus;
  testId: string;
  title?: string;
}) {
  return (
    <article
      className="rounded-2xl border border-[var(--border)] bg-white p-5"
      data-testid={testId}
      title={title}
    >
      <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {badge(status)}
      </p>
    </article>
  );
}

function TrendChart({
  points,
  title,
  subtitle,
  testId,
  revenueOnly = false,
}: {
  points: Array<{
    date: string;
    spendMinor: bigint | null;
    spendFormatted: string | null;
    revenueMinor: bigint | null;
    revenueFormatted: string | null;
  }>;
  title: string;
  subtitle: string;
  testId: string;
  revenueOnly?: boolean;
}) {
  const spendMax = points.reduce(
    (max, point) =>
      point.spendMinor !== null && point.spendMinor > max
        ? point.spendMinor
        : max,
    0n,
  );
  const revenueMax = points.reduce(
    (max, point) =>
      point.revenueMinor !== null && point.revenueMinor > max
        ? point.revenueMinor
        : max,
    0n,
  );
  const sampled =
    points.length > 60
      ? points.filter((_, index) => index % Math.ceil(points.length / 60) === 0)
      : points;
  return (
    <section
      className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-6"
      data-testid={testId}
    >
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
      {!revenueOnly ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Spend and revenue use independent scales.
        </p>
      ) : null}
      <div className="mt-4 flex h-40 items-end gap-1">
        {sampled.map((point) => {
          const spendPct =
            spendMax > 0n && point.spendMinor
              ? Number((point.spendMinor * 100n) / spendMax)
              : 0;
          const revenuePct =
            revenueMax > 0n && point.revenueMinor
              ? Number((point.revenueMinor * 100n) / revenueMax)
              : 0;
          return (
            <div
              className="flex h-full flex-1 items-end justify-center gap-0.5"
              key={point.date}
              title={`${point.date} · spend ${point.spendFormatted ?? "—"} · revenue ${point.revenueFormatted ?? "—"}`}
            >
              {!revenueOnly ? (
                <div
                  className="w-1/2 rounded-t bg-slate-400"
                  style={{ height: `${Math.max(spendPct, 0)}%` }}
                />
              ) : null}
              <div
                className="w-1/2 rounded-t bg-[#19d0a2]"
                style={{ height: `${Math.max(revenuePct, 0)}%` }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CampaignTable({
  organizationSlug,
  rows,
  unresolved,
  sort,
  customerId,
  range,
}: {
  organizationSlug: string;
  rows: Array<{
    campaignId: string;
    campaignName: string;
    advertisingChannelType: string | null;
    campaignStatus: string | null;
    spend: MoneyMetric;
    clicks: CountMetric;
    leads: CountMetric;
    won: CountMetric;
    revenue: MoneyMetric;
    costPerLead: CostMetric;
    costPerWon: CostMetric;
    roas: RatioMetric;
    anomaly: "NO_SPEND_WITH_REVENUE" | null;
  }>;
  unresolved: {
    leads: CountMetric;
    won: CountMetric;
    revenue: MoneyMetric;
  };
  sort: string;
  customerId: string;
  range: string;
}) {
  const href = (next: string) =>
    `/app/${organizationSlug}/analytics/revenue?customer=${customerId}&range=${range}&sort=${next}`;
  return (
    <section className="mt-8 overflow-x-auto rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Campaigns</h2>
      <table
        className="mt-4 w-full min-w-[900px] text-left text-sm"
        data-testid="campaign-table"
      >
        <thead>
          <tr className="text-[var(--muted)]">
            <th className="pb-2 font-semibold">Campaign</th>
            <th className="pb-2 font-semibold">Type</th>
            <th className="pb-2 font-semibold">
              <Link href={href("spend")}>Spend</Link>
            </th>
            <th className="pb-2 font-semibold">Clicks</th>
            <th className="pb-2 font-semibold">
              <Link href={href("leads")}>Leads</Link>
            </th>
            <th className="pb-2 font-semibold">Won</th>
            <th className="pb-2 font-semibold">
              <Link href={href("revenue")}>Attributed revenue</Link>
            </th>
            <th className="pb-2 font-semibold">Cost / Lead</th>
            <th className="pb-2 font-semibold">Cost / Won</th>
            <th className="pb-2 font-semibold">
              <Link href={href("roas")}>ROAS</Link>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className="border-t border-[var(--border)]"
              key={row.campaignId}
            >
              <td className="py-2">
                <span className="font-semibold">{row.campaignName}</span>
                {row.campaignStatus && row.campaignStatus !== "ENABLED" ? (
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {row.campaignStatus}
                  </span>
                ) : null}
                {row.anomaly === "NO_SPEND_WITH_REVENUE" ? (
                  <span className="ml-2 text-xs font-semibold text-amber-800">
                    No spend
                  </span>
                ) : null}
              </td>
              <td className="py-2">{row.advertisingChannelType ?? "—"}</td>
              <td className="py-2">{row.spend.formatted ?? "unavailable"}</td>
              <td className="py-2">{row.clicks.value}</td>
              <td className="py-2">{row.leads.value}</td>
              <td className="py-2">{row.won.value}</td>
              <td className="py-2">{row.revenue.formatted ?? "unavailable"}</td>
              <td className="py-2">{row.costPerLead.formatted ?? "—"}</td>
              <td className="py-2">{row.costPerWon.formatted ?? "—"}</td>
              <td className="py-2">
                {row.roas.formatted ?? "—"}
                {row.roas.status === "PARTIAL_ATTRIBUTION" ? (
                  <span className="ml-1 text-xs">PARTIAL ATTRIBUTION</span>
                ) : null}
              </td>
            </tr>
          ))}
          <tr
            className="border-t border-[var(--border)] bg-slate-50"
            data-testid="campaign-unresolved"
          >
            <td className="py-2 font-semibold">Campaign unresolved</td>
            <td className="py-2">—</td>
            <td className="py-2">—</td>
            <td className="py-2">—</td>
            <td className="py-2">{unresolved.leads.value}</td>
            <td className="py-2">{unresolved.won.value}</td>
            <td className="py-2">{unresolved.revenue.formatted ?? "—"}</td>
            <td className="py-2">—</td>
            <td className="py-2">—</td>
            <td className="py-2">—</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-[var(--muted)]">Sorted by {sort}.</p>
    </section>
  );
}
