import Link from "next/link";
import { LeadOutcomeBadge } from "@/components/lead-outcome-badge";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/authorization/session";
import { listOrganizationLeads } from "@/server/tracking/queries";
import type { LeadOutcomeStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Attribution" };

function countStatus(
  totals: Array<{ attributionStatus: string; _count: { _all: number } }>,
  status: string,
) {
  return (
    totals.find((row) => row.attributionStatus === status)?._count._all ?? 0
  );
}

function countOutcome(
  totals: Array<{ status: LeadOutcomeStatus; _count: { _all: number } }>,
  status: LeadOutcomeStatus,
) {
  return totals.find((row) => row.status === status)?._count._all ?? 0;
}

function signalLabel(
  touch: {
    hasGclid: boolean;
    hasGbraid: boolean;
    hasWbraid: boolean;
  } | null,
) {
  if (!touch) return "None";
  const parts = [];
  if (touch.hasGclid) parts.push("GCLID captured");
  if (touch.hasGbraid) parts.push("GBRAID captured");
  if (touch.hasWbraid) parts.push("WBRAID captured");
  return parts.join(", ") || "None";
}

function formatWhen(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AttributionPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    status?: string;
    website?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  const { organizationSlug } = await params;
  const filters = await searchParams;
  const user = await requireUser();
  const {
    leads,
    totals,
    outcomeTotals,
    wonRevenue,
    trackingConfigs,
    websites,
  } = await listOrganizationLeads(user.id, organizationSlug, {
    status: filters.status,
    websiteId: filters.website,
    from: filters.from,
    to: filters.to,
    q: filters.q,
  });
  const attributed = countStatus(totals, "ATTRIBUTED");
  const unattributed =
    countStatus(totals, "UNATTRIBUTED") +
    countStatus(totals, "ORGANIC_OR_DIRECT") +
    countStatus(totals, "EXPIRED");
  const trackingOn = trackingConfigs.some((row) => row.status === "ENABLED");
  const newCount = countOutcome(outcomeTotals, "NEW");
  const qualifiedCount = countOutcome(outcomeTotals, "QUALIFIED");
  const wonCount = countOutcome(outcomeTotals, "WON");
  const lostCount = countOutcome(outcomeTotals, "LOST");
  const terminal = wonCount + lostCount;
  const winRate = terminal > 0 ? Math.round((wonCount / terminal) * 100) : null;

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Attribution</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Real-visitor Google Ads click correlation plus manual lead outcomes.
        This is LeadGuard&apos;s last-eligible-paid-touch model, not Google Ads
        reporting attribution. Revenue is not ROAS.
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Leads captured</p>
          <p className="mt-4 text-3xl font-bold">
            {newCount + qualifiedCount + wonCount + lostCount}
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">
            Attributed to Google Ads
          </p>
          <p className="mt-4 text-3xl font-bold">{attributed}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Unattributed</p>
          <p className="mt-4 text-3xl font-bold">{unattributed}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Tracking status</p>
          <p className="mt-4 text-3xl font-bold">
            {trackingOn ? "Receiving" : "Not installed"}
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">New</p>
          <p className="mt-4 text-3xl font-bold">{newCount}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Qualified</p>
          <p className="mt-4 text-3xl font-bold">{qualifiedCount}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Won</p>
          <p className="mt-4 text-3xl font-bold">{wonCount}</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Lost</p>
          <p className="mt-4 text-3xl font-bold">{lostCount}</p>
        </article>
      </section>
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">LeadGuard win rate</p>
          <p className="mt-4 text-3xl font-bold">
            {winRate === null ? "—" : `${winRate}%`}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Won / (Won + Lost). Not a marketing attribution claim.
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Won revenue</p>
          {wonRevenue.length === 0 ? (
            <p className="mt-4 text-3xl font-bold">—</p>
          ) : (
            <ul className="mt-4 space-y-1 text-lg font-bold">
              {wonRevenue.map((row) => {
                const currency = row.revenueCurrencyCode ?? "";
                const minor = row._sum.revenueAmountMinor ?? 0n;
                if (!currency) return null;
                return <li key={currency}>{formatMoney(minor, currency)}</li>;
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Totals stay per currency. Currencies are never added together.
          </p>
        </article>
      </section>
      <form
        className="mt-8 grid gap-3 rounded-2xl border border-[var(--border)] bg-white p-6 sm:grid-cols-2 lg:grid-cols-5"
        method="get"
      >
        <label className="text-sm font-semibold">
          Status
          <select
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            name="status"
            defaultValue={filters.status ?? ""}
          >
            <option value="">All</option>
            <option value="NEW">New</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="WON">Won</option>
            <option value="LOST">Lost</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Website
          <select
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            name="website"
            defaultValue={filters.website ?? ""}
          >
            <option value="">All</option>
            {websites.map((website) => (
              <option key={website.id} value={website.id}>
                {website.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          From
          <input
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
          />
        </label>
        <label className="text-sm font-semibold">
          To
          <input
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
          />
        </label>
        <label className="text-sm font-semibold">
          Lead ID
          <input
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="lgl_… or external id"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-5">
          <button
            className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
            type="submit"
          >
            Filter
          </button>
        </div>
      </form>
      <section className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Leads</h2>
        {leads.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            No leads captured yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {leads.map((lead) => {
              const outcomeStatus = lead.outcome?.status ?? "NEW";
              const showRevenue =
                outcomeStatus === "WON" &&
                lead.outcome?.revenueAmountMinor != null &&
                lead.outcome.revenueCurrencyCode;
              return (
                <li className="py-4" key={lead.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="font-semibold text-[#235347] hover:underline"
                      href={`/app/${organizationSlug}/attribution/${lead.id}`}
                    >
                      {lead.publicLeadId}
                    </Link>
                    <LeadOutcomeBadge status={outcomeStatus} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {lead.website.name} · {formatWhen(lead.occurredAt)} ·{" "}
                    {lead.attribution?.attributionStatus === "ATTRIBUTED"
                      ? "Google Ads"
                      : "Unattributed"}{" "}
                    · {signalLabel(lead.attribution?.primaryTouch ?? null)}
                    {outcomeStatus === "WON"
                      ? ` · ${
                          showRevenue
                            ? formatMoney(
                                lead.outcome!.revenueAmountMinor!,
                                lead.outcome!.revenueCurrencyCode!,
                              )
                            : "—"
                        }`
                      : ""}
                  </p>
                  {outcomeStatus === "WON" && !showRevenue ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Revenue not entered
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
