"use client";

import { useActionState, useState } from "react";
import {
  disableTrackingAction,
  enableTrackingAction,
  rotateTrackingSecretsAction,
  verifyTrackingInstallationAction,
  type TrackingFormState,
} from "@/server/tracking/actions";

export function WebsiteTrackingSetup({
  organizationSlug,
  websiteId,
  status,
  siteKey,
  lastEventLabel,
  lastAttributionLabel,
  lastLeadLabel,
  snippet,
  consentSnippet,
  canManage,
}: {
  organizationSlug: string;
  websiteId: string;
  status: "NOT_CONFIGURED" | "DISABLED" | "ENABLED";
  siteKey: string | null;
  lastEventLabel: string;
  lastAttributionLabel: string;
  lastLeadLabel: string;
  snippet: string;
  consentSnippet: string;
  canManage: boolean;
}) {
  const enable = enableTrackingAction.bind(null, organizationSlug, websiteId);
  const rotate = rotateTrackingSecretsAction.bind(
    null,
    organizationSlug,
    websiteId,
  );
  const [enableState, enableFormAction, enabling] = useActionState(
    enable,
    {} as TrackingFormState,
  );
  const [rotateState, rotateFormAction, rotating] = useActionState(
    rotate,
    {} as TrackingFormState,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const shownSiteKey = enableState.siteKey ?? rotateState.siteKey ?? siteKey;
  const shownSecret = enableState.serverSecret ?? rotateState.serverSecret;
  const health =
    status !== "ENABLED"
      ? "Not installed"
      : lastEventLabel !== "No events yet"
        ? "Receiving data"
        : "Needs attention";

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  }

  return (
    <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Revenue attribution</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Capture Google Ads click IDs (GCLID, GBRAID, WBRAID) from real visitors.
        Tracking stays off until you enable it. This is not won/lost or revenue.
      </p>
      <p className="mt-3 text-sm font-semibold">{health}</p>
      {status === "ENABLED" ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Last SDK event
            </dt>
            <dd className="mt-1">{lastEventLabel}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Last attribution
            </dt>
            <dd className="mt-1">{lastAttributionLabel}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">
              Last real lead
            </dt>
            <dd className="mt-1">{lastLeadLabel}</dd>
          </div>
        </dl>
      ) : null}
      {canManage && status !== "ENABLED" ? (
        <form action={enableFormAction} className="mt-4">
          <button
            className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
            disabled={enabling}
            type="submit"
          >
            Enable tracking
          </button>
        </form>
      ) : null}
      {enableState.error || rotateState.error ? (
        <p className="mt-3 text-sm text-red-800">
          {enableState.error ?? rotateState.error}
        </p>
      ) : null}
      {shownSecret ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 font-mono text-sm">
          Server secret (shown once): {shownSecret}
        </p>
      ) : null}
      {status === "ENABLED" && shownSiteKey ? (
        <div className="mt-6 space-y-4 text-sm">
          <div>
            <p className="font-semibold">Install snippet</p>
            <pre
              className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs"
              data-testid="tracking-snippet"
            >
              {snippet}
            </pre>
            <button
              className="mt-2 text-sm font-semibold text-[#235347] hover:underline"
              onClick={() => void copy("snippet", snippet)}
              type="button"
            >
              {copied === "snippet" ? "Copied" : "Copy snippet"}
            </button>
          </div>
          <div>
            <p className="font-semibold">Consent</p>
            <p className="mt-1 text-[var(--muted)]">
              Default mode is required. Call this from your CMP after the
              visitor grants attribution consent. Click IDs stay in memory until
              then. If the visitor leaves before consent, attribution may be
              lost.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs">
              {consentSnippet}
            </pre>
          </div>
          <div>
            <p className="font-semibold">Lead confirmation</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--muted)]">
              <li>
                JavaScript: LeadGuard.trackLead after a successful submit.
              </li>
              <li>
                Hidden field + server API (recommended): attach the attribution
                token and POST /api/tracking/v1/leads.
              </li>
              <li>Custom backend: send the token with your own eventId.</li>
            </ol>
          </div>
          <form
            action={verifyTrackingInstallationAction.bind(
              null,
              organizationSlug,
              websiteId,
            )}
          >
            <button
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              type="submit"
            >
              Verify tracking installation
            </button>
          </form>
          {canManage ? (
            <div className="flex flex-wrap gap-3">
              <form action={rotateFormAction}>
                <input name="kind" type="hidden" value="site" />
                <button
                  className="text-sm font-semibold text-[#235347] hover:underline disabled:opacity-60"
                  disabled={rotating}
                  type="submit"
                >
                  Rotate site key
                </button>
              </form>
              <form action={rotateFormAction}>
                <input name="kind" type="hidden" value="server" />
                <button
                  className="text-sm font-semibold text-[#235347] hover:underline disabled:opacity-60"
                  disabled={rotating}
                  type="submit"
                >
                  Rotate server secret
                </button>
              </form>
              <form
                action={disableTrackingAction.bind(
                  null,
                  organizationSlug,
                  websiteId,
                )}
              >
                <button
                  className="text-sm font-semibold text-red-800 hover:underline"
                  type="submit"
                >
                  Disable tracking
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
