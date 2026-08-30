"use client";

import { useActionState } from "react";
import {
  updateNotificationChannelAction,
  type NotificationFormState,
} from "@/server/notifications/actions";
import type { NotificationChannelStatus } from "@/generated/prisma/enums";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function NotificationChannelSettingsForm({
  organizationSlug,
  channelId,
  type,
  name,
  emailAddress,
  webhookUrl,
  notifyOnOpened,
  notifyOnResolved,
  status,
}: {
  organizationSlug: string;
  channelId: string;
  type: "EMAIL" | "WEBHOOK";
  name: string;
  emailAddress: string | null;
  webhookUrl: string | null;
  notifyOnOpened: boolean;
  notifyOnResolved: boolean;
  status: NotificationChannelStatus;
}) {
  const action = updateNotificationChannelAction.bind(
    null,
    organizationSlug,
    channelId,
  );
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
          defaultValue={name}
        />
      </label>
      {type === "EMAIL" ? (
        <label className="block text-sm font-semibold">
          Email address
          <input
            className={inputClassName}
            type="email"
            name="email"
            required
            maxLength={254}
            defaultValue={emailAddress ?? ""}
          />
        </label>
      ) : (
        <label className="block text-sm font-semibold">
          Webhook URL
          <input
            className={inputClassName}
            type="url"
            name="url"
            required
            maxLength={2048}
            defaultValue={webhookUrl ?? ""}
          />
        </label>
      )}
      <label className="block text-sm font-semibold">
        Status
        <select className={inputClassName} name="status" defaultValue={status}>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Preferences</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="notifyOnOpened"
            defaultChecked={notifyOnOpened}
          />
          Incident opened
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="notifyOnResolved"
            defaultChecked={notifyOnResolved}
          />
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
        {pending ? "Saving…" : "Save channel"}
      </button>
    </form>
  );
}
