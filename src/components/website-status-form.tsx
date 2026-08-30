"use client";

import { useActionState } from "react";
import {
  setWebsiteStatusAction,
  type WebsiteFormState,
} from "@/server/websites/actions";
import type { WebsiteStatus } from "@/generated/prisma/enums";

export function WebsiteStatusForm({
  organizationSlug,
  websiteId,
  status,
}: {
  organizationSlug: string;
  websiteId: string;
  status: WebsiteStatus;
}) {
  const nextStatus = status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const label = nextStatus === "DISABLED" ? "Disable" : "Enable";
  const bound = setWebsiteStatusAction.bind(null, organizationSlug, websiteId);
  const [state, formAction, pending] = useActionState(
    async (_previous: WebsiteFormState, formData: FormData) => bound(formData),
    {} as WebsiteFormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="status" value={nextStatus} />
      {state.error ? (
        <p className="mb-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving…" : label}
      </button>
    </form>
  );
}
