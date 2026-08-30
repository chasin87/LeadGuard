"use client";

import { useActionState } from "react";
import {
  rotateFormReceiptWebhookSecretAction,
  updateFormReceiptSettingsAction,
  type MonitorFormState,
} from "@/server/monitors/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function FormReceiptSettingsForm({
  organizationSlug,
  websiteId,
  monitorId,
  receiptMode,
  receiptTimeoutMinutes,
  receiptVerified,
  inboundReady,
  inboundTemplate,
  webhookPrefix,
  webhookEndpoint,
}: {
  organizationSlug: string;
  websiteId: string;
  monitorId: string;
  receiptMode: "NONE" | "INBOUND_EMAIL" | "RECEIPT_WEBHOOK";
  receiptTimeoutMinutes: number;
  receiptVerified: boolean;
  inboundReady: boolean;
  inboundTemplate: string | null;
  webhookPrefix: string | null;
  webhookEndpoint: string;
}) {
  const save = updateFormReceiptSettingsAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const rotate = rotateFormReceiptWebhookSecretAction.bind(
    null,
    organizationSlug,
    websiteId,
    monitorId,
  );
  const [state, formAction, pending] = useActionState(
    save,
    {} as MonitorFormState,
  );
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotate,
    {} as MonitorFormState,
  );
  const secret = state.webhookSecret || rotateState.webhookSecret;

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold">
            Lead receipt verification
          </legend>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Form success means the website accepted the submission. Receipt
            success means LeadGuard got proof the lead arrived downstream.
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            <label className="flex gap-2">
              <input
                type="radio"
                name="receiptMode"
                value="NONE"
                defaultChecked={receiptMode === "NONE"}
              />
              Disabled
            </label>
            <label className="flex gap-2">
              <input
                type="radio"
                name="receiptMode"
                value="INBOUND_EMAIL"
                defaultChecked={receiptMode === "INBOUND_EMAIL"}
                disabled={!inboundReady}
              />
              Inbound email
            </label>
            <label className="flex gap-2">
              <input
                type="radio"
                name="receiptMode"
                value="RECEIPT_WEBHOOK"
                defaultChecked={receiptMode === "RECEIPT_WEBHOOK"}
              />
              Webhook
            </label>
          </div>
        </fieldset>
        {!inboundReady ? (
          <p className="text-sm text-[var(--muted)]">
            Inbound email is unavailable until INBOUND_EMAIL_PROVIDER,
            INBOUND_EMAIL_DOMAIN and INBOUND_EMAIL_WEBHOOK_SECRET are configured
            on the server. Do not point workflows at a placeholder address.
          </p>
        ) : null}
        <label className="block text-sm font-semibold">
          Receipt timeout (minutes)
          <input
            className={inputClassName}
            name="receiptTimeoutMinutes"
            type="number"
            min={1}
            max={120}
            defaultValue={receiptTimeoutMinutes}
          />
        </label>
        {inboundTemplate ? (
          <div>
            <p className="text-sm font-semibold">Receipt address</p>
            <code className="mt-1 block break-all text-sm">
              {inboundTemplate}
            </code>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Configure your lead workflow to send a confirmation to this
              address after the lead has been successfully received.
            </p>
          </div>
        ) : null}
        <p className="text-sm text-[var(--muted)]">
          Receipt endpoint: <code className="break-all">{webhookEndpoint}</code>
        </p>
        <p className="text-sm text-[var(--muted)]">
          Example payload: {"{"}
          &quot;submissionId&quot;: &quot;LG-…&quot;{"}"}
        </p>
        {webhookPrefix ? (
          <p className="text-sm">Signing secret {webhookPrefix}</p>
        ) : null}
        <p className="text-sm text-[var(--muted)]">
          {receiptVerified
            ? "Receipt verification has succeeded at least once."
            : "Send a real test lead after configuring the downstream workflow. Scheduled tests stay paused until that receipt is confirmed. There is no shortcut to mark this as working."}
        </p>
        {state.error || rotateState.error ? (
          <p className="text-sm text-red-700">
            {state.error || rotateState.error}
          </p>
        ) : null}
        {state.message ? (
          <p className="text-sm text-[#19d0a2]">{state.message}</p>
        ) : null}
        {secret ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            Store this signing secret now. It is shown only this once:{" "}
            <code className="break-all">{secret}</code>
          </p>
        ) : null}
        <button
          className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save receipt settings"}
        </button>
      </form>
      {receiptMode === "RECEIPT_WEBHOOK" ? (
        <form action={rotateAction}>
          <button
            className="text-sm font-semibold text-[#19d0a2]"
            disabled={rotatePending}
            type="submit"
          >
            {rotatePending ? "Rotating…" : "Rotate signing secret"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
