"use client";

import { useActionState } from "react";
import {
  syncGoogleAdsCustomerAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function GoogleAdsSyncButton({
  organizationSlug,
  googleCustomerId,
}: {
  organizationSlug: string;
  googleCustomerId: string;
}) {
  const action = syncGoogleAdsCustomerAction.bind(
    null,
    organizationSlug,
    googleCustomerId,
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
        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        Sync now
      </button>
    </form>
  );
}
