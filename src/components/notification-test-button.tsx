"use client";

import { useActionState } from "react";
import {
  sendTestNotificationAction,
  type NotificationFormState,
} from "@/server/notifications/actions";

export function NotificationTestButton({
  organizationSlug,
  channelId,
}: {
  organizationSlug: string;
  channelId: string;
}) {
  const action = sendTestNotificationAction.bind(
    null,
    organizationSlug,
    channelId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as NotificationFormState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <button
        className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Sending…" : "Send test"}
      </button>
      {state.testStatus === "sent" ? (
        <p className="text-sm text-emerald-800">Test notification sent.</p>
      ) : null}
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
