"use client";

import { useActionState } from "react";
import {
  updateMonitorAction,
  type MonitorFormState,
} from "@/server/monitors/actions";
import {
  FormFieldMappingEditor,
  type FieldMappingDraft,
} from "@/components/form-field-mapping-editor";
import { formatInterval } from "@/lib/monitoring/display";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function FormMonitorSettingsForm({
  organizationSlug,
  websiteId,
  monitorId,
  name,
  url,
  intervalSeconds,
  timeoutMs,
  status,
  consecutiveFailuresBeforeIncident,
  allowedIntervals,
  viewport,
  formSelector,
  submitSelector,
  cookieAcceptSelector,
  fieldMappings,
  successMode,
  successSelector,
  successUrlPattern,
  successText,
  submissionTimeoutMs,
  testProfileId,
  profiles,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutMs: number;
  status: "ACTIVE" | "PAUSED";
  consecutiveFailuresBeforeIncident: number;
  allowedIntervals: number[];
  viewport: "DESKTOP" | "MOBILE";
  formSelector: string;
  submitSelector: string;
  cookieAcceptSelector?: string | null;
  fieldMappings: FieldMappingDraft[];
  successMode: string;
  successSelector?: string | null;
  successUrlPattern?: string | null;
  successText?: string | null;
  submissionTimeoutMs: number;
  testProfileId?: string | null;
  profiles: Array<{ id: string; name: string }>;
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
      <input type="hidden" name="type" value="FORM" />
      <label className="block text-sm font-semibold">
        Monitor name
        <input
          className={inputClassName}
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
          name="url"
          defaultValue={url}
          required
          maxLength={2048}
        />
      </label>
      <label className="block text-sm font-semibold">
        Check frequency
        <select
          className={inputClassName}
          name="intervalSeconds"
          defaultValue={String(intervalSeconds)}
        >
          {allowedIntervals.map((interval) => (
            <option key={interval} value={interval}>
              {formatInterval(interval)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Viewport
        <select
          className={inputClassName}
          name="viewport"
          defaultValue={viewport}
        >
          <option value="DESKTOP">Desktop (1440 × 900)</option>
          <option value="MOBILE">Mobile (390 × 844)</option>
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Form selector
        <input
          className={inputClassName}
          name="formSelector"
          defaultValue={formSelector}
          required
        />
      </label>
      <label className="block text-sm font-semibold">
        Submit selector
        <input
          className={inputClassName}
          name="submitSelector"
          defaultValue={submitSelector}
          required
        />
      </label>
      <label className="block text-sm font-semibold">
        Cookie accept selector
        <input
          className={inputClassName}
          name="cookieAcceptSelector"
          defaultValue={cookieAcceptSelector ?? ""}
        />
      </label>
      <p className="text-sm font-semibold">Fields</p>
      <FormFieldMappingEditor initial={fieldMappings} />
      <label className="block text-sm font-semibold">
        Success mode
        <select
          className={inputClassName}
          name="successMode"
          defaultValue={successMode}
        >
          <option value="ANY">Any configured signal</option>
          <option value="SELECTOR">Success selector</option>
          <option value="URL">Success URL</option>
          <option value="TEXT">Success text</option>
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Success selector
        <input
          className={inputClassName}
          name="successSelector"
          defaultValue={successSelector ?? ""}
        />
      </label>
      <label className="block text-sm font-semibold">
        Success URL
        <input
          className={inputClassName}
          name="successUrlPattern"
          defaultValue={successUrlPattern ?? ""}
        />
      </label>
      <label className="block text-sm font-semibold">
        Success text
        <input
          className={inputClassName}
          name="successText"
          defaultValue={successText ?? ""}
        />
      </label>
      <label className="block text-sm font-semibold">
        Test profile
        <select
          className={inputClassName}
          name="testProfileId"
          defaultValue={testProfileId ?? ""}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Timeout
        <select
          className={inputClassName}
          name="timeoutMs"
          defaultValue={String(timeoutMs)}
        >
          <option value="5000">5 seconds</option>
          <option value="10000">10 seconds</option>
          <option value="20000">20 seconds</option>
          <option value="30000">30 seconds</option>
          <option value="45000">45 seconds</option>
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Submission timeout
        <select
          className={inputClassName}
          name="submissionTimeoutMs"
          defaultValue={String(submissionTimeoutMs)}
        >
          <option value="5000">5 seconds</option>
          <option value="10000">10 seconds</option>
          <option value="20000">20 seconds</option>
          <option value="30000">30 seconds</option>
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
      <label className="block text-sm font-semibold">
        Status
        <select className={inputClassName} name="status" defaultValue={status}>
          <option value="PAUSED">Paused</option>
          <option value="ACTIVE">Active (scheduled tests)</option>
        </select>
      </label>
      <p className="text-sm text-[var(--muted)]">
        Saving form selectors resets verification. Scheduled tests stay paused
        until you send a successful real test lead.
      </p>
      {state.error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.fieldErrors?.formSelector ? (
        <p className="text-sm text-red-700">
          {state.fieldErrors.formSelector[0]}
        </p>
      ) : null}
      {state.fieldErrors?.fieldMappings ? (
        <p className="text-sm text-red-700">
          {state.fieldErrors.fieldMappings[0]}
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
