"use client";

import { useActionState } from "react";
import {
  refreshGoogleAdsImpactAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function GoogleAdsImpactRefreshButton({
  organizationSlug,
  incidentId,
}: {
  organizationSlug: string;
  incidentId: string;
}) {
  const action = refreshGoogleAdsImpactAction.bind(
    null,
    organizationSlug,
    incidentId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as GoogleAdsFormState,
  );
  return (
    <form action={formAction}>
      {state.error ? (
        <p className="mb-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="text-sm font-semibold text-[#19d0a2] hover:underline disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        Refresh Google Ads impact
      </button>
    </form>
  );
}
