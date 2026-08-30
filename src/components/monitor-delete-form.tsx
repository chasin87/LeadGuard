"use client";

import { useActionState } from "react";
import {
  deleteMonitorAction,
  type MonitorFormState,
} from "@/server/monitors/actions";

export function MonitorDeleteForm({
  organizationSlug,
  websiteId,
  monitorId,
  name,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  name: string;
}) {
  const action = deleteMonitorAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as MonitorFormState,
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
        <p className="mb-3 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded-xl border border-red-200 bg-white px-5 py-3 font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Deleting…" : "Delete monitor"}
      </button>
    </form>
  );
}
