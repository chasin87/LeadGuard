"use client";

import { useActionState } from "react";
import {
  backfillGoogleAdsAnalyticsAction,
  refreshGoogleAdsAnalyticsAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function AnalyticsRefreshButtons({
  organizationSlug,
  googleAdsCustomerId,
}: {
  organizationSlug: string;
  googleAdsCustomerId: string;
}) {
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshGoogleAdsAnalyticsAction.bind(
      null,
      organizationSlug,
      googleAdsCustomerId,
    ),
    {} as GoogleAdsFormState,
  );
  const [backfillState, backfillAction, backfillPending] = useActionState(
    backfillGoogleAdsAnalyticsAction.bind(
      null,
      organizationSlug,
      googleAdsCustomerId,
    ),
    {} as GoogleAdsFormState,
  );
  return (
    <div className="flex flex-wrap gap-3">
      <form action={refreshAction}>
        <button
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          disabled={refreshPending}
          type="submit"
        >
          Refresh Google Ads data
        </button>
      </form>
      <form action={backfillAction}>
        <button
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          disabled={backfillPending}
          type="submit"
        >
          Backfill 90 days
        </button>
      </form>
      {refreshState.error ? (
        <p className="text-sm text-red-800">{refreshState.error}</p>
      ) : null}
      {backfillState.error ? (
        <p className="text-sm text-red-800">{backfillState.error}</p>
      ) : null}
    </div>
  );
}
