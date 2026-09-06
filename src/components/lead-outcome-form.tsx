"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { LeadOutcomeStatus } from "@/generated/prisma/enums";
import {
  updateLeadOutcomeAction,
  type LeadOutcomeFormState,
} from "@/server/leads/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function LeadOutcomeForm({
  organizationSlug,
  leadId,
  version,
  status,
  revenueAmount,
  revenueCurrency,
  defaultCurrency,
}: {
  organizationSlug: string;
  leadId: string;
  version: number;
  status: LeadOutcomeStatus;
  revenueAmount: string | null;
  revenueCurrency: string | null;
  defaultCurrency: string | null;
}) {
  const action = updateLeadOutcomeAction.bind(null, organizationSlug, leadId);
  const [state, formAction, pending] = useActionState(
    action,
    {} as LeadOutcomeFormState,
  );
  const mutationId = useMemo(() => crypto.randomUUID(), []);
  const [hydrated, setHydrated] = useState(false);
  const [nextStatus, setNextStatus] = useState<LeadOutcomeStatus>(status);
  const terminalCorrection =
    (status === "WON" || status === "LOST") && nextStatus !== status;
  const leavingWonWithRevenue =
    status === "WON" && Boolean(revenueAmount) && nextStatus === "LOST";
  useEffect(() => {
    // Client-only marker for Playwright; keep out of the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration flag
    setHydrated(true);
  }, []);

  return (
    <form
      action={formAction}
      className="mt-6 space-y-4"
      data-hydrated={hydrated ? "true" : "false"}
      data-testid="lead-outcome-form"
    >
      <input name="mutationId" type="hidden" value={mutationId} />
      <input name="expectedVersion" type="hidden" value={String(version)} />
      <h3 className="text-base font-bold">Edit outcome</h3>
      <label className="block text-sm font-semibold">
        Status
        <select
          className={inputClassName}
          name="status"
          value={nextStatus}
          onChange={(event) =>
            setNextStatus(event.target.value as LeadOutcomeStatus)
          }
        >
          <option value="NEW">New</option>
          <option value="QUALIFIED">Qualified</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
        </select>
      </label>
      {nextStatus === "WON" ? (
        <>
          <label className="block text-sm font-semibold">
            Revenue amount
            <input
              className={inputClassName}
              name="revenueAmount"
              defaultValue={status === "WON" ? (revenueAmount ?? "") : ""}
              placeholder="4500.00"
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            Canonical decimal, for example 4500.00. Leave empty if revenue is
            not entered yet. 0.00 is a real zero, not unknown.
          </p>
          <label className="block text-sm font-semibold">
            Currency
            <input
              className={inputClassName}
              name="revenueCurrency"
              defaultValue={revenueCurrency ?? defaultCurrency ?? ""}
              placeholder="EUR"
              maxLength={3}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </>
      ) : null}
      <label className="block text-sm font-semibold">
        Effective at (optional)
        <input
          className={inputClassName}
          name="effectiveAt"
          type="datetime-local"
        />
      </label>
      <p className="text-xs text-[var(--muted)]">
        Defaults to now. You may backdate after the lead was created, but not
        into the future.
      </p>
      {leavingWonWithRevenue ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          This will remove the current revenue value from this lead. The
          previous value remains in the audit history.
        </p>
      ) : null}
      {terminalCorrection ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            name="confirmTerminalTransition"
            value="true"
            required
          />
          <span>
            I confirm this is a correction or reactivation of a Won or Lost
            lead.
          </span>
        </label>
      ) : null}
      {state.error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
          disabled={pending}
          name="intent"
          type="submit"
          value="save"
        >
          {pending ? "Saving…" : "Save outcome"}
        </button>
        {status === "WON" && revenueAmount !== null ? (
          <button
            className="rounded-xl border border-[var(--border)] px-5 py-3 font-semibold hover:bg-slate-50 disabled:opacity-60"
            disabled={pending}
            name="intent"
            type="submit"
            value="clear_revenue"
          >
            Clear revenue
          </button>
        ) : null}
      </div>
    </form>
  );
}
