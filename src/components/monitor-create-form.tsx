"use client";

import { useActionState, useState } from "react";
import {
  createMonitorAction,
  type MonitorFormState,
} from "@/server/monitors/actions";
import { FormFieldMappingEditor } from "@/components/form-field-mapping-editor";
import { formatInterval } from "@/lib/monitoring/display";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function MonitorCreateForm({
  organizationSlug,
  websiteId,
  defaultUrl,
  httpIntervals,
  browserIntervals,
  formIntervals,
  defaultHttpIntervalSeconds,
  defaultBrowserIntervalSeconds,
  defaultFormIntervalSeconds,
  defaultHttpTimeoutMs,
  defaultBrowserTimeoutMs,
  defaultFormTimeoutMs,
}: {
  organizationSlug: string;
  websiteId: string;
  defaultUrl: string;
  httpIntervals: number[];
  browserIntervals: number[];
  formIntervals: number[];
  defaultHttpIntervalSeconds: number;
  defaultBrowserIntervalSeconds: number;
  defaultFormIntervalSeconds: number;
  defaultHttpTimeoutMs: number;
  defaultBrowserTimeoutMs: number;
  defaultFormTimeoutMs: number;
}) {
  const action = createMonitorAction.bind(null, organizationSlug, websiteId);
  const [state, formAction, pending] = useActionState(
    action,
    {} as MonitorFormState,
  );
  const [type, setType] = useState<"HTTP" | "BROWSER" | "FORM">("HTTP");
  const intervals =
    type === "FORM"
      ? formIntervals
      : type === "BROWSER"
        ? browserIntervals
        : httpIntervals;
  const defaultInterval =
    type === "FORM"
      ? defaultFormIntervalSeconds
      : type === "BROWSER"
        ? defaultBrowserIntervalSeconds
        : defaultHttpIntervalSeconds;
  const defaultTimeout =
    type === "FORM"
      ? defaultFormTimeoutMs
      : type === "BROWSER"
        ? defaultBrowserTimeoutMs
        : defaultHttpTimeoutMs;

  return (
    <form action={formAction} className="space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold">Monitor type</legend>
        <div className="mt-3 grid gap-3">
          <label className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] bg-slate-50 p-4">
            <input
              type="radio"
              name="type"
              value="HTTP"
              checked={type === "HTTP"}
              onChange={() => setType("HTTP")}
            />
            <span>
              <span className="block font-semibold">HTTP Monitor</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">
                Fast check for status, SSL, redirects and availability.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] bg-slate-50 p-4">
            <input
              type="radio"
              name="type"
              value="BROWSER"
              checked={type === "BROWSER"}
              onChange={() => setType("BROWSER")}
            />
            <span>
              <span className="block font-semibold">Browser Monitor</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">
                Opens the page in a real browser and checks that it renders
                correctly.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] bg-slate-50 p-4">
            <input
              type="radio"
              name="type"
              value="FORM"
              checked={type === "FORM"}
              onChange={() => setType("FORM")}
            />
            <span>
              <span className="block font-semibold">Form Monitor</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">
                Fills and submits a lead form to verify a visitor can complete
                it. This creates a real test lead.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <label className="block text-sm font-semibold">
        Monitor name
        <input
          className={inputClassName}
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={80}
          placeholder="Airco landingpage"
        />
      </label>
      {state.fieldErrors?.name ? (
        <p className="text-sm text-red-700">{state.fieldErrors.name[0]}</p>
      ) : null}
      <label className="block text-sm font-semibold">
        URL
        <input
          className={inputClassName}
          type="text"
          name="url"
          required
          maxLength={2048}
          defaultValue={defaultUrl}
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        Must stay on the same host as this website. Paths such as{" "}
        <code>/airco</code> are allowed.
      </p>
      {state.fieldErrors?.url ? (
        <p className="text-sm text-red-700">{state.fieldErrors.url[0]}</p>
      ) : null}
      <label className="block text-sm font-semibold">
        Check frequency
        <select
          className={inputClassName}
          name="intervalSeconds"
          defaultValue={String(defaultInterval)}
          key={`${type}-interval`}
        >
          {intervals.map((interval) => (
            <option key={interval} value={interval}>
              {formatInterval(interval)}
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
              defaultValue="DESKTOP"
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
              maxLength={80}
              placeholder="Quote request button"
            />
          </label>
          <label className="block text-sm font-semibold">
            Required element selector
            <input
              className={inputClassName}
              type="text"
              name="requiredSelector"
              maxLength={300}
              placeholder='[data-testid="quote-cta"]'
            />
          </label>
          <p className="text-sm text-[var(--muted)]">
            Optional CSS selector. Copy the selector, not a raw HTML attribute:
            use{" "}
            <code className="font-mono">[data-slot=&quot;button&quot;]</code>{" "}
            instead of{" "}
            <code className="font-mono">data-slot=&quot;button&quot;</code>. The
            element must exist and be visible. LeadGuard does not accept cookie
            banners or click through popups.
          </p>
          {state.fieldErrors?.requiredSelector ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.requiredSelector[0]}
            </p>
          ) : null}
        </>
      ) : null}
      {type === "FORM" ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Form monitors submit a real test lead through this form. Configure
            only lead or contact forms that are safe for test submissions. Test
            leads can appear in email or CRM.
          </p>
          <label className="block text-sm font-semibold">
            Viewport
            <select
              className={inputClassName}
              name="viewport"
              defaultValue="DESKTOP"
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
              required
              placeholder="form#quote-form"
            />
          </label>
          <label className="block text-sm font-semibold">
            Submit selector
            <input
              className={inputClassName}
              name="submitSelector"
              required
              placeholder='button[type="submit"]'
            />
          </label>
          <p className="text-sm font-semibold">Fields</p>
          <FormFieldMappingEditor />
          <label className="block text-sm font-semibold">
            Success mode
            <select
              className={inputClassName}
              name="successMode"
              defaultValue="ANY"
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
              placeholder=".thank-you"
            />
          </label>
          <label className="block text-sm font-semibold">
            Success URL
            <input
              className={inputClassName}
              name="successUrlPattern"
              placeholder="/bedankt"
            />
          </label>
          <label className="block text-sm font-semibold">
            Success text
            <input
              className={inputClassName}
              name="successText"
              placeholder="Bedankt voor uw aanvraag"
            />
          </label>
          <p className="text-sm font-semibold">Test data</p>
          <label className="block text-sm font-semibold">
            Test name
            <input
              className={inputClassName}
              name="testDisplayName"
              defaultValue="LeadGuard Test"
            />
          </label>
          <label className="block text-sm font-semibold">
            Test email
            <input
              className={inputClassName}
              name="testEmail"
              type="email"
              placeholder="leadtests@your-domain.nl"
            />
          </label>
          <label className="block text-sm font-semibold">
            Test phone
            <input
              className={inputClassName}
              name="testPhone"
              placeholder="0612345678"
            />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input className="mt-1" type="checkbox" name="plusAddressing" />
            <span>
              Add a unique plus-tag to the test email when the mailbox supports
              it.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              name="safeFormConfirmed"
              value="true"
              required
            />
            <span>
              I confirm that submitting this form creates only a safe test
              lead/contact request.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              name="submitConsentConfirmed"
              value="true"
              required
            />
            <span>
              I allow LeadGuard to submit real test leads. These submissions can
              appear in CRM or email.
            </span>
          </label>
          <input type="hidden" name="submissionTimeoutMs" value="20000" />
          {state.fieldErrors?.formSelector ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.formSelector[0]}
            </p>
          ) : null}
          {state.fieldErrors?.submitSelector ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.submitSelector[0]}
            </p>
          ) : null}
          {state.fieldErrors?.fieldMappings ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.fieldMappings[0]}
            </p>
          ) : null}
          {state.fieldErrors?.successSelector ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.successSelector[0]}
            </p>
          ) : null}
          {state.fieldErrors?.testEmail ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.testEmail[0]}
            </p>
          ) : null}
          {state.fieldErrors?.safeFormConfirmed ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.safeFormConfirmed[0]}
            </p>
          ) : null}
          {state.fieldErrors?.submitConsentConfirmed ? (
            <p className="text-sm text-red-700">
              {state.fieldErrors.submitConsentConfirmed[0]}
            </p>
          ) : null}
        </div>
      ) : null}
      <details className="rounded-xl border border-[var(--border)] p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Advanced settings
        </summary>
        <label className="mt-4 block text-sm font-semibold">
          Timeout
          <select
            className={inputClassName}
            name="timeoutMs"
            defaultValue={String(defaultTimeout)}
            key={`${type}-timeout`}
          >
            {type === "BROWSER" || type === "FORM" ? (
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
        <label className="mt-4 block text-sm font-semibold">
          Open an incident after
          <select
            className={inputClassName}
            name="consecutiveFailuresBeforeIncident"
            defaultValue="2"
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map(
              (value) => (
                <option key={value} value={value}>
                  {value} consecutive failed {value === 1 ? "check" : "checks"}
                </option>
              ),
            )}
          </select>
        </label>
      </details>
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
        {pending ? "Checking URL…" : "Add monitor"}
      </button>
    </form>
  );
}
