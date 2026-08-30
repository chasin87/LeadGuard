"use client";

import { useActionState } from "react";
import {
  approveGoogleAdsDomainAction,
  ignoreGoogleAdsDomainAction,
  type GoogleAdsFormState,
} from "@/server/google-ads/actions";

export function GoogleAdsApprovalControls({
  organizationSlug,
  targetId,
}: {
  organizationSlug: string;
  targetId: string;
}) {
  const approve = approveGoogleAdsDomainAction.bind(
    null,
    organizationSlug,
    targetId,
  );
  const ignore = ignoreGoogleAdsDomainAction.bind(
    null,
    organizationSlug,
    targetId,
  );
  const [approveState, approveAction, approvePending] = useActionState(
    approve,
    {} as GoogleAdsFormState,
  );
  const [ignoreState, ignoreAction, ignorePending] = useActionState(
    ignore,
    {} as GoogleAdsFormState,
  );

  return (
    <div className="flex flex-wrap gap-3">
      {approveState.error || ignoreState.error ? (
        <p className="w-full text-sm text-red-700" role="alert">
          {approveState.error || ignoreState.error}
        </p>
      ) : null}
      <form action={approveAction}>
        <button
          className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
          disabled={approvePending}
          type="submit"
        >
          Approve website
        </button>
      </form>
      <form action={ignoreAction}>
        <button
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
          disabled={ignorePending}
          type="submit"
        >
          Ignore
        </button>
      </form>
    </div>
  );
}
