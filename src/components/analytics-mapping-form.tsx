"use client";

import { useActionState } from "react";
import {
  disableGoogleAdsAnalyticsAction,
  enableGoogleAdsAnalyticsAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function AnalyticsMappingForm({
  organizationSlug,
  websites,
  customers,
  suggestedCustomerByWebsite,
  configs,
}: {
  organizationSlug: string;
  websites: Array<{ id: string; name: string; hostname: string }>;
  customers: Array<{ id: string; descriptiveName: string }>;
  suggestedCustomerByWebsite: Record<string, string>;
  configs: Array<{
    id: string;
    status: string;
    website: { name: string; hostname: string };
    customer: { descriptiveName: string };
  }>;
}) {
  const [saveState, saveAction, savePending] = useActionState(
    enableGoogleAdsAnalyticsAction.bind(null, organizationSlug),
    {} as GoogleAdsFormState,
  );

  return (
    <div className="space-y-6">
      <form action={saveAction} className="space-y-4">
        <label className="block text-sm font-semibold">
          Website
          <select
            className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
            name="websiteId"
            required
          >
            {websites.map((website) => (
              <option key={website.id} value={website.id}>
                {website.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Google Ads advertiser account
          <select
            className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
            name="googleAdsCustomerId"
            defaultValue={
              websites[0]
                ? (suggestedCustomerByWebsite[websites[0].id] ??
                  customers[0]?.id ??
                  "")
                : (customers[0]?.id ?? "")
            }
            required
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.descriptiveName}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded-xl bg-[#172033] px-4 py-2 text-sm font-semibold text-white"
          disabled={savePending || customers.length === 0}
          type="submit"
        >
          Enable revenue analytics
        </button>
        {saveState.error ? (
          <p className="text-sm text-red-800">{saveState.error}</p>
        ) : null}
      </form>

      {configs.length > 0 ? (
        <ul className="space-y-3">
          {configs.map((config) => (
            <li
              key={config.id}
              className="rounded-xl border border-[var(--border)] p-4 text-sm"
            >
              <p className="font-semibold">{config.website.name}</p>
              <p className="text-[var(--muted)]">
                {config.customer.descriptiveName} · {config.status}
              </p>
              {config.status === "ACTIVE" ? (
                <DisableAnalyticsButton
                  configId={config.id}
                  organizationSlug={organizationSlug}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DisableAnalyticsButton({
  organizationSlug,
  configId,
}: {
  organizationSlug: string;
  configId: string;
}) {
  const [state, formAction, pending] = useActionState(
    disableGoogleAdsAnalyticsAction.bind(null, organizationSlug, configId),
    {} as GoogleAdsFormState,
  );
  return (
    <form action={formAction} className="mt-3">
      {state.error ? (
        <p className="mb-2 text-sm text-red-800">{state.error}</p>
      ) : null}
      <button
        className="text-sm font-semibold text-red-800"
        disabled={pending}
        type="submit"
      >
        Disable
      </button>
    </form>
  );
}
