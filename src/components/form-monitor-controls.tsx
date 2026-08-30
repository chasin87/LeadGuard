"use client";

import { useActionState } from "react";
import {
  sendFormTestAction,
  setMonitorStatusAction,
  validateFormMonitorAction,
  type MonitorFormState,
} from "@/server/monitors/actions";

export function FormMonitorControls({
  organizationSlug,
  websiteId,
  monitorId,
  websiteActive,
  monitorStatus,
  configurationStatus,
  verified,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  websiteActive: boolean;
  monitorStatus: "ACTIVE" | "PAUSED";
  configurationStatus: string;
  verified: boolean;
}) {
  const validate = validateFormMonitorAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const sendTest = sendFormTestAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const setStatus = setMonitorStatusAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const [validateState, validateAction, validatePending] = useActionState(
    validate,
    {} as MonitorFormState,
  );
  const [testState, testAction, testPending] = useActionState(
    sendTest,
    {} as MonitorFormState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    setStatus,
    {} as MonitorFormState,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <form action={validateAction}>
          <button
            className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
            disabled={!websiteActive || validatePending}
            type="submit"
          >
            {validatePending ? "Queuing…" : "Validate configuration"}
          </button>
        </form>
        <form action={testAction} className="flex flex-wrap items-center gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              name="confirmed"
              value="true"
              required
            />
            <span>
              This will submit a real test lead through the configured form. If
              a previous submission may already have reached the website,
              retesting can create a second test lead.
            </span>
          </label>
          <button
            className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
            disabled={!websiteActive || testPending}
            type="submit"
          >
            {testPending ? "Queuing…" : "Send real test lead"}
          </button>
        </form>
        {verified && monitorStatus === "PAUSED" ? (
          <form action={statusAction}>
            <input type="hidden" name="status" value="ACTIVE" />
            <button
              className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
              disabled={!websiteActive || statusPending}
              type="submit"
            >
              Enable scheduled tests
            </button>
          </form>
        ) : null}
      </div>
      <p className="text-sm text-[var(--muted)]">
        Validate configuration never submits. Send real test lead submits one
        test through the live form. Configuration:{" "}
        {configurationStatus.toLowerCase()}.
      </p>
      {validateState.message ? (
        <p className="text-sm text-[#19d0a2]">{validateState.message}</p>
      ) : null}
      {testState.message ? (
        <p className="text-sm text-[#19d0a2]">{testState.message}</p>
      ) : null}
      {validateState.error || testState.error || statusState.error ? (
        <p className="text-sm text-red-700">
          {validateState.error || testState.error || statusState.error}
        </p>
      ) : null}
    </div>
  );
}
