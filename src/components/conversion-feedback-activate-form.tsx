"use client";

import { useActionState } from "react";
import { DisableConversionFeedbackButton } from "@/components/conversion-export-buttons";
import {
  activateConversionFeedbackAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function ConversionFeedbackActivateForm({
  organizationSlug,
  configId,
  active,
}: {
  organizationSlug: string;
  configId: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(
    activateConversionFeedbackAction.bind(null, organizationSlug, configId),
    {} as GoogleAdsFormState,
  );
  if (active) {
    return (
      <DisableConversionFeedbackButton
        organizationSlug={organizationSlug}
        configId={configId}
      />
    );
  }

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-amber-900">
        LeadGuard will send future won leads and their configured conversion
        value to this Google Ads conversion action.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" name="confirmed" type="checkbox" />
        <span>I understand this enables Google conversion writes.</span>
      </label>
      {state.error ? (
        <p className="text-sm text-red-800">{state.error}</p>
      ) : null}
      <button
        className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
        disabled={pending}
        type="submit"
      >
        Activate conversion feedback
      </button>
    </form>
  );
}
