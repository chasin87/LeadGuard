import { GoogleAdsImpactRefreshButton } from "@/components/google-ads-impact-refresh-button";
import {
  presentGoogleAdsImpact,
  type GoogleAdsImpactView,
} from "@/server/google-ads/impact/presentation";

export function GoogleAdsIncidentImpactCard({
  organizationSlug,
  incidentId,
  view,
  canRefresh,
}: {
  organizationSlug: string;
  incidentId: string;
  view: GoogleAdsImpactView;
  canRefresh: boolean;
}) {
  return (
    <section className="mt-8 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">{view.title}</h2>
      {view.provisionalLabel ? (
        <p className="mt-2 text-sm text-amber-900">{view.provisionalLabel}</p>
      ) : null}
      {view.unavailableReason ? (
        <p className="mt-4 text-sm">{view.unavailableReason}</p>
      ) : null}
      {view.spendValue ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              {view.spendLabel}
            </dt>
            <dd className="mt-1 text-xl font-bold">{view.spendValue}</dd>
          </div>
          {view.clicksValue ? (
            <div>
              <dt className="font-semibold text-[var(--muted)]">
                {view.clicksLabel}
              </dt>
              <dd className="mt-1 text-xl font-bold">{view.clicksValue}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-[var(--muted)]">Attribution</dt>
          <dd className="mt-1">{view.methodLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">Confidence</dt>
          <dd className="mt-1">{view.confidenceLabel}</dd>
        </div>
        {view.coverageLabel ? (
          <div>
            <dt className="font-semibold text-[var(--muted)]">Coverage</dt>
            <dd className="mt-1">{view.coverageLabel}</dd>
          </div>
        ) : null}
        {view.dataThrough ? (
          <div>
            <dt className="font-semibold text-[var(--muted)]">Data through</dt>
            <dd className="mt-1">{view.dataThrough}</dd>
          </div>
        ) : null}
      </dl>
      {view.dailyContext ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{view.dailyContext}</p>
      ) : null}
      {view.freshness ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{view.freshness}</p>
      ) : null}
      <p className="mt-4 text-sm text-[var(--muted)]">{view.info}</p>
      {canRefresh ? (
        <div className="mt-4">
          <GoogleAdsImpactRefreshButton
            organizationSlug={organizationSlug}
            incidentId={incidentId}
          />
        </div>
      ) : null}
    </section>
  );
}

export { presentGoogleAdsImpact };
