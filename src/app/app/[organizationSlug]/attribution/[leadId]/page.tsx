import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadOutcomeBadge } from "@/components/lead-outcome-badge";
import { LeadOutcomeForm } from "@/components/lead-outcome-form";
import { GoogleAdsConversionCard } from "@/components/google-ads-conversion-card";
import { formatMoney, minorUnitsToDecimal } from "@/lib/money";
import { requireUser } from "@/server/authorization/session";
import { getLeadDetail } from "@/server/tracking/queries";
import { getLeadConversionExport } from "@/server/google-ads/conversion-queries";
import type { LeadOutcomeChangeType } from "@/generated/prisma/enums";

export const metadata = { title: "Lead" };

function signals(
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

function moneyLabel(amount: bigint | null, currency: string | null) {
  if (amount === null || !currency) return "not entered";
  return formatMoney(amount, currency);
}

function eventCopy(event: {
  changeType: LeadOutcomeChangeType;
  beforeStatus: string | null;
  afterStatus: string;
  beforeRevenueAmountMinor: bigint | null;
  afterRevenueAmountMinor: bigint | null;
  beforeRevenueCurrencyCode: string | null;
  afterRevenueCurrencyCode: string | null;
  actor: { name: string } | null;
}) {
  const actor = event.actor?.name ?? "LeadGuard";
  if (event.changeType === "CREATED") {
    return "Lead created";
  }
  if (event.changeType === "REVENUE_CHANGED") {
    if (event.afterRevenueAmountMinor === null) {
      return `${actor} cleared revenue`;
    }
    return `${actor} changed revenue to ${moneyLabel(
      event.afterRevenueAmountMinor,
      event.afterRevenueCurrencyCode,
    )}`;
  }
  const statusLabel = event.afterStatus.toLowerCase();
  if (event.changeType === "STATUS_AND_REVENUE_CHANGED") {
    if (
      event.beforeStatus === "WON" &&
      event.afterStatus === "LOST" &&
      event.beforeRevenueAmountMinor !== null
    ) {
      return `${actor} corrected status from Won to Lost. Previous revenue removed from current outcome`;
    }
    return `${actor} marked lead as ${statusLabel}. Revenue ${moneyLabel(
      event.afterRevenueAmountMinor,
      event.afterRevenueCurrencyCode,
    )}`;
  }
  return `${actor} marked lead as ${statusLabel}`;
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; leadId: string }>;
}) {
  const { organizationSlug, leadId } = await params;
  const user = await requireUser();
  const detail = await getLeadDetail(user.id, organizationSlug, leadId);
  if (!detail) notFound();
  const { lead, canManage, organization } = detail;
  const primary = lead.attribution?.primaryTouch ?? null;
  const first = lead.attribution?.firstTouch ?? null;
  const outcome = lead.outcome;
  const conversionExport = await getLeadConversionExport(
    organization.id,
    lead.id,
  );
  const revenueEntered =
    outcome?.status === "WON" &&
    outcome.revenueAmountMinor !== null &&
    outcome.revenueCurrencyCode;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/attribution`}
        >
          Attribution
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        {lead.publicLeadId}
      </h1>
      <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--muted)]">Created</dt>
            <dd className="mt-1">{formatWhen(lead.occurredAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Website</dt>
            <dd className="mt-1">{lead.website.name}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Source</dt>
            <dd className="mt-1">
              {lead.attribution?.attributionStatus === "ATTRIBUTED"
                ? "Google Ads"
                : lead.source === "SERVER_API"
                  ? "Server API"
                  : "Browser SDK"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Primary attribution
            </dt>
            <dd className="mt-1">Last paid touch</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Click identifiers
            </dt>
            <dd className="mt-1">{signals(primary)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Landing page</dt>
            <dd className="mt-1">{primary?.landingPath ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">First touch</dt>
            <dd className="mt-1">
              {first ? `${first.channel} · ${signals(first)}` : "—"}
            </dd>
          </div>
        </dl>
      </section>
      <section className="mt-6 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Outcome</h2>
        {outcome ? (
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-[var(--muted)]">Status</dt>
              <dd className="mt-1">
                <LeadOutcomeBadge status={outcome.status} />
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                {outcome.status === "WON"
                  ? "Won at"
                  : outcome.status === "LOST"
                    ? "Lost at"
                    : outcome.status === "QUALIFIED"
                      ? "Qualified at"
                      : "Status changed"}
              </dt>
              <dd className="mt-1">
                {formatWhen(
                  outcome.wonAt ??
                    outcome.lostAt ??
                    outcome.qualifiedAt ??
                    outcome.statusChangedAt,
                )}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Revenue</dt>
              <dd className="mt-1">
                {outcome.status !== "WON"
                  ? "—"
                  : revenueEntered
                    ? formatMoney(
                        outcome.revenueAmountMinor!,
                        outcome.revenueCurrencyCode!,
                      )
                    : "Revenue not entered"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Source</dt>
              <dd className="mt-1">
                {outcome.revenueSource === "MANUAL"
                  ? "Manual"
                  : (outcome.revenueSource ?? "—")}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                Last updated
              </dt>
              <dd className="mt-1">{formatWhen(outcome.updatedAt)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Outcome is missing for this lead.
          </p>
        )}
        {canManage && outcome ? (
          <LeadOutcomeForm
            key={outcome.version}
            organizationSlug={organizationSlug}
            leadId={lead.id}
            version={outcome.version}
            status={outcome.status}
            revenueAmount={
              outcome.revenueAmountMinor !== null && outcome.revenueCurrencyCode
                ? minorUnitsToDecimal(
                    outcome.revenueAmountMinor,
                    outcome.revenueCurrencyCode,
                  )
                : null
            }
            revenueCurrency={outcome.revenueCurrencyCode}
            defaultCurrency={organization.defaultRevenueCurrencyCode}
          />
        ) : null}
      </section>
      {conversionExport ||
      (primary &&
        (primary.hasGclid || primary.hasGbraid || primary.hasWbraid) &&
        outcome?.status === "WON") ? (
        <GoogleAdsConversionCard
          organizationSlug={organizationSlug}
          leadId={lead.id}
          canManage={canManage}
          exportRow={conversionExport}
        />
      ) : null}
      <section className="mt-6 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">History</h2>
        {outcome?.events.length ? (
          <ol className="mt-4 space-y-3">
            {outcome.events.map((event) => (
              <li className="text-sm" key={event.id}>
                <p className="font-semibold">{formatWhen(event.createdAt)}</p>
                <p className="mt-1 text-[var(--muted)]">{eventCopy(event)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">No history yet.</p>
        )}
      </section>
    </div>
  );
}
