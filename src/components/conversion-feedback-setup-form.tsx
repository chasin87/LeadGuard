"use client";

import { useActionState, useState } from "react";
import {
  refreshConversionActionsAction,
  saveConversionFeedbackAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function ConversionFeedbackSetupForm({
  organizationSlug,
  websites,
  customers,
}: {
  organizationSlug: string;
  websites: Array<{ id: string; name: string; hostname: string }>;
  customers: Array<{ id: string; descriptiveName: string }>;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshConversionActionsAction.bind(null, organizationSlug),
    {} as GoogleAdsFormState & {
      actions?: Array<{ conversionActionId: string; name: string }>;
    },
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveConversionFeedbackAction.bind(null, organizationSlug),
    {} as GoogleAdsFormState,
  );
  const actions = refreshState.actions ?? [];

  return (
    <div className="space-y-6">
      <form action={refreshAction} className="space-y-3">
        <label className="block text-sm font-semibold">
          Advertiser account
          <select
            className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
            name="googleAdsCustomerId"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.descriptiveName}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          disabled={!customerId || refreshPending}
          type="submit"
        >
          Refresh conversion actions
        </button>
        {refreshState.error ? (
          <p className="text-sm text-red-800">{refreshState.error}</p>
        ) : null}
        {refreshState.actions && refreshState.actions.length === 0 ? (
          <p className="text-sm text-amber-800">
            No suitable conversion action found. Create/import the appropriate
            offline conversion action in Google Ads first, then refresh this
            list.
          </p>
        ) : null}
      </form>

      <form action={saveAction} className="space-y-4">
        <input name="googleAdsCustomerId" type="hidden" value={customerId} />
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
          Conversion action
          <select
            className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
            name="conversionActionId"
            required
          >
            {actions.map((action) => (
              <option
                key={action.conversionActionId}
                value={action.conversionActionId}
              >
                {action.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Event source
          <select
            className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
            defaultValue="OTHER"
            name="eventSource"
          >
            <option value="OTHER">Other</option>
            <option value="WEB">Web</option>
            <option value="PHONE">Phone</option>
            <option value="APP">App</option>
            <option value="IN_STORE">In store</option>
            <option value="MESSAGE">Message</option>
          </select>
        </label>
        <p className="text-sm text-[var(--muted)]">
          Event source is the business conversion source, not the original lead
          click. Other is selected until you confirm a more specific source.
        </p>
        <label className="block text-sm font-semibold">
          Value policy
          <select
            className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2"
            defaultValue="REVENUE_IF_AVAILABLE"
            name="valuePolicy"
          >
            <option value="REVENUE_IF_AVAILABLE">
              Realized revenue when available
            </option>
            <option value="REQUIRE_REVENUE">Require realized revenue</option>
            <option value="NO_VALUE">No conversion value</option>
          </select>
        </label>
        {saveState.error ? (
          <p className="text-sm text-red-800">{saveState.error}</p>
        ) : null}
        <button
          className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
          disabled={savePending || actions.length === 0}
          type="submit"
        >
          Save mapping
        </button>
      </form>
    </div>
  );
}
