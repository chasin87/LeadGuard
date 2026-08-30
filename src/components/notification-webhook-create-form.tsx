"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createWebhookChannelAction,
  type NotificationFormState,
} from "@/server/notifications/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function NotificationWebhookCreateForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const action = createWebhookChannelAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as NotificationFormState,
  );

  if (state.secret) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Store this signing secret now. It is shown here after create and can
          also be revealed later by owners and admins.
        </p>
        <label className="block text-sm font-semibold">
          Signing secret
          <input
            className={`${inputClassName} font-mono`}
            readOnly
            value={state.secret}
          />
        </label>
        <Link
          className="inline-block font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/settings/notifications`}
        >
          Back to notifications
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm font-semibold">
        Channel name
        <input
          className={inputClassName}
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={80}
          placeholder="Automation"
        />
      </label>
      {state.fieldErrors?.name ? (
        <p className="text-sm text-red-700">{state.fieldErrors.name[0]}</p>
      ) : null}
      <label className="block text-sm font-semibold">
        Webhook URL
        <input
          className={inputClassName}
          type="url"
          name="url"
          required
          maxLength={2048}
          placeholder="https://example.com/api/leadguard"
        />
      </label>
      {state.fieldErrors?.url ? (
        <p className="text-sm text-red-700">{state.fieldErrors.url[0]}</p>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Preferences</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notifyOnOpened" defaultChecked />
          Incident opened
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notifyOnResolved" defaultChecked />
          Incident resolved
        </label>
      </fieldset>
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
        {pending ? "Saving…" : "Add webhook channel"}
      </button>
    </form>
  );
}
