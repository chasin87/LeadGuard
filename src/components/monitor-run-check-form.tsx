"use client";

import { useActionState } from "react";
import {
  runMonitorCheckAction,
  setMonitorStatusAction,
  type MonitorFormState,
} from "@/server/monitors/actions";
import type { MonitorStatus } from "@/generated/prisma/enums";

export function MonitorRunCheckForm({
  organizationSlug,
  websiteId,
  monitorId,
  websiteActive,
  monitorStatus,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  websiteActive: boolean;
  monitorStatus: MonitorStatus;
}) {
  const run = runMonitorCheckAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const [state, formAction, pending] = useActionState(
    run,
    {} as MonitorFormState,
  );
  const disabled = !websiteActive || monitorStatus !== "ACTIVE";

  return (
    <form action={formAction}>
      {state.message ? (
        <p className="mb-2 text-sm text-[#19d0a2]">{state.message}</p>
      ) : null}
      {state.error ? (
        <p className="mb-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
        disabled={pending || disabled}
        type="submit"
      >
        {pending ? "Queuing…" : "Run check now"}
      </button>
    </form>
  );
}

export function MonitorPauseForm({
  organizationSlug,
  websiteId,
  monitorId,
  status,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  status: MonitorStatus;
}) {
  const next = status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  const label = next === "PAUSED" ? "Pause" : "Resume";
  const bound = setMonitorStatusAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const [state, formAction, pending] = useActionState(
    bound,
    {} as MonitorFormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="status" value={next} />
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
