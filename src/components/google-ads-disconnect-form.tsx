"use client";

import { useActionState } from "react";
import {
  disconnectGoogleAdsAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function GoogleAdsDisconnectForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const action = disconnectGoogleAdsAction.bind(null, organizationSlug);
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
        className="text-sm font-semibold text-red-800 hover:underline disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        Disconnect Google Ads
      </button>
    </form>
  );
}
