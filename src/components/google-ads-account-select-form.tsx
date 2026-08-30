"use client";

import { useActionState } from "react";
import {
  selectGoogleAdsCustomersAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function GoogleAdsAccountSelectForm({
  organizationSlug,
  customers,
}: {
  organizationSlug: string;
  customers: Array<{
    googleCustomerId: string;
    descriptiveName: string;
    isManager: boolean;
    selected: boolean;
  }>;
}) {
  const action = selectGoogleAdsCustomersAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as GoogleAdsFormState,
  );
  const advertisers = customers.filter((item) => !item.isManager);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <ul className="space-y-2">
        {advertisers.map((customer) => (
          <li key={customer.googleCustomerId}>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="googleCustomerId"
                value={customer.googleCustomerId}
                defaultChecked={customer.selected}
              />
              <span>
                {customer.descriptiveName}
                <span className="ml-2 text-[var(--muted)]">
                  {customer.googleCustomerId}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        Save accounts and sync
      </button>
    </form>
  );
}
