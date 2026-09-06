"use client";

import { useActionState } from "react";
import {
  disableConversionFeedbackAction,
  queueLeadConversionExportAction,
  retryConversionExportAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function RetryConversionExportButton({
  organizationSlug,
  exportId,
  compact = false,
}: {
  organizationSlug: string;
  exportId: string;
  compact?: boolean;
}) {
  const action = retryConversionExportAction.bind(
    null,
    organizationSlug,
    exportId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as GoogleAdsFormState,
  );
  return (
    <form action={formAction} className={compact ? "mt-2" : "mt-4"}>
      {state.error ? (
        <p className="mb-2 text-sm text-red-800">{state.error}</p>
      ) : null}
      <button
        className={
          compact
            ? "text-xs font-semibold text-[#19d0a2] disabled:opacity-60"
            : "rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        }
        disabled={pending}
        type="submit"
      >
        {compact ? "Retry" : "Retry conversion"}
      </button>
    </form>
  );
}

export function QueueLeadConversionButton({
  organizationSlug,
  leadId,
}: {
  organizationSlug: string;
  leadId: string;
}) {
  const action = queueLeadConversionExportAction.bind(
    null,
    organizationSlug,
    leadId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as GoogleAdsFormState,
  );
  return (
    <form action={formAction}>
      {state.error ? (
        <p className="mb-2 text-sm text-red-800">{state.error}</p>
      ) : null}
      <button
        className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        Queue Google Ads conversion
      </button>
    </form>
  );
}

export function DisableConversionFeedbackButton({
  organizationSlug,
  configId,
}: {
  organizationSlug: string;
  configId: string;
}) {
  const action = disableConversionFeedbackAction.bind(
    null,
    organizationSlug,
    configId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as GoogleAdsFormState,
  );
  return (
    <form action={formAction}>
      {state.error ? (
        <p className="mb-2 text-sm text-red-800">{state.error}</p>
      ) : null}
      <button
        className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        Disable conversion feedback
      </button>
    </form>
  );
}
