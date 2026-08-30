"use client";

import { useActionState } from "react";
import {
  deleteWebsiteAction,
  type WebsiteFormState,
} from "@/server/websites/actions";

export function WebsiteDeleteForm({
  organizationSlug,
  websiteId,
  name,
}: {
  organizationSlug: string;
  websiteId: string;
  name: string;
}) {
  const action = deleteWebsiteAction.bind(null, organizationSlug, websiteId);
  const [state, formAction, pending] = useActionState(
    action,
    {} as WebsiteFormState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${name}?`)) {
          event.preventDefault();
        }
      }}
    >
      {state.error ? (
        <p
          className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded-xl border border-red-200 bg-white px-5 py-3 font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Deleting…" : "Delete website"}
      </button>
    </form>
  );
}
