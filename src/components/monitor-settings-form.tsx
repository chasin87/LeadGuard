"use client";

import { useActionState } from "react";
import {
  updateMonitorAction,
  type MonitorFormState,
} from "@/server/monitors/actions";
import type { MonitorStatus } from "@/generated/prisma/enums";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function MonitorSettingsForm({
  organizationSlug,
  websiteId,
  monitorId,
  type,
  name,
  url,
  intervalSeconds,
  timeoutMs,
  status,
  consecutiveFailuresBeforeIncident,
  allowedIntervals,
  viewport,
  requiredSelector,
  requiredElementName,
  urlLocked,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  type: "HTTP" | "BROWSER";
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutMs: number;
  status: MonitorStatus;
  consecutiveFailuresBeforeIncident: number;
  allowedIntervals: number[];
  viewport?: "DESKTOP" | "MOBILE";
  requiredSelector?: string | null;
  requiredElementName?: string | null;
  urlLocked?: boolean;
}) {
  const action = updateMonitorAction.bind(
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
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="type" value={type} />
      <label className="block text-sm font-semibold">
        Monitor name
        <input
          className={inputClassName}
          type="text"
          name="name"
          defaultValue={name}
          required
          minLength={2}
          maxLength={80}
        />
      </label>
      <label className="block text-sm font-semibold">
        URL
        <input
          className={inputClassName}
          type="text"
          name="url"
          defaultValue={url}
          required
          maxLength={2048}
          readOnly={urlLocked}
        />
      </label>
      {urlLocked ? (
        <p className="text-sm text-[var(--muted)]">
          This URL is managed by Google Ads sync and cannot be overwritten.
        </p>
      ) : null}
      <label className="block text-sm font-semibold">
        Check frequency
        <select
          className={inputClassName}
          name="intervalSeconds"
          defaultValue={String(intervalSeconds)}
        >
          {allowedIntervals.map((interval) => (
            <option key={interval} value={interval}>
              Every {interval / 60} minutes
            </option>
          ))}
        </select>
      </label>
      {type === "BROWSER" ? (
        <>
          <label className="block text-sm font-semibold">
            Viewport
            <select
              className={inputClassName}
              name="viewport"
              defaultValue={viewport ?? "DESKTOP"}
            >
              <option value="DESKTOP">Desktop (1440 × 900)</option>
              <option value="MOBILE">Mobile (390 × 844)</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Required element name
            <input
              className={inputClassName}
              type="text"
              name="requiredElementName"
              defaultValue={requiredElementName ?? ""}
              maxLength={80}
            />
          </label>
          <label className="block text-sm font-semibold">
            Required element selector
            <input
              className={inputClassName}
              type="text"
              name="requiredSelector"
              defaultValue={requiredSelector ?? ""}
              maxLength={300}
              placeholder='[data-testid="quote-cta"]'
            />
          </label>
          <p className="text-sm text-[var(--muted)]">
            Use a CSS selector with brackets for attributes, for example{" "}
            <code className="font-mono">[data-slot=&quot;button&quot;]</code>.
          </p>
          {state.fieldErrors?.requiredSelector ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.requiredSelector[0]}
            </p>
          ) : null}
        </>
      ) : null}
      <label className="block text-sm font-semibold">
        Timeout
        <select
          className={inputClassName}
          name="timeoutMs"
          defaultValue={String(timeoutMs)}
        >
          {type === "BROWSER" ? (
            <>
              <option value="5000">5 seconds</option>
              <option value="10000">10 seconds</option>
              <option value="20000">20 seconds</option>
              <option value="30000">30 seconds</option>
              <option value="45000">45 seconds</option>
            </>
          ) : (
            <>
              <option value="1000">1 second</option>
              <option value="5000">5 seconds</option>
              <option value="10000">10 seconds</option>
              <option value="20000">20 seconds</option>
              <option value="30000">30 seconds</option>
            </>
          )}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Open an incident after
        <select
          className={inputClassName}
          name="consecutiveFailuresBeforeIncident"
          defaultValue={String(consecutiveFailuresBeforeIncident)}
        >
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value} consecutive failed {value === 1 ? "check" : "checks"}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-[var(--muted)]">
        Changing this applies from the next check. It does not open or close an
        incident by itself.
      </p>
      <label className="block text-sm font-semibold">
        Status
        <select className={inputClassName} name="status" defaultValue={status}>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
        </select>
      </label>
      {state.error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Checking URL…" : "Save changes"}
      </button>
    </form>
  );
}
