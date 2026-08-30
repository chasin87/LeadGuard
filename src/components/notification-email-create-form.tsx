"use client";

import { useActionState } from "react";
import {
  createEmailChannelAction,
  type NotificationFormState,
} from "@/server/notifications/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function NotificationEmailCreateForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const action = createEmailChannelAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as NotificationFormState,
  );

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
          placeholder="Operations"
        />
      </label>
      {state.fieldErrors?.name ? (
        <p className="text-sm text-red-700">{state.fieldErrors.name[0]}</p>
      ) : null}
      <label className="block text-sm font-semibold">
        Email address
        <input
          className={inputClassName}
          type="email"
          name="email"
          required
          maxLength={254}
          placeholder="alerts@example.nl"
        />
      </label>
      {state.fieldErrors?.email ? (
        <p className="text-sm text-red-700">{state.fieldErrors.email[0]}</p>
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
        {pending ? "Saving…" : "Add email channel"}
      </button>
    </form>
  );
}
