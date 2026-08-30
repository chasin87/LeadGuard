"use client";

import { useActionState } from "react";
import {
  revealWebhookSecretAction,
  rotateWebhookSecretAction,
  type NotificationFormState,
} from "@/server/notifications/actions";

export function NotificationWebhookSecretControls({
  organizationSlug,
  channelId,
}: {
  organizationSlug: string;
  channelId: string;
}) {
  const reveal = revealWebhookSecretAction.bind(
    null,
    organizationSlug,
    channelId,
  );
  const rotate = rotateWebhookSecretAction.bind(
    null,
    organizationSlug,
    channelId,
  );
  const [revealState, revealAction, revealing] = useActionState(
    reveal,
    {} as NotificationFormState,
  );
  const [rotateState, rotateAction, rotating] = useActionState(
    rotate,
    {} as NotificationFormState,
  );
  const secret = rotateState.secret ?? revealState.revealed;

  return (
    <div className="space-y-3">
      <p className="font-mono text-sm text-[var(--muted)]">
        Signing secret
        <br />
        {secret ?? "••••••••••••"}
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={revealAction}>
          <button
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
            disabled={revealing}
            type="submit"
          >
            Reveal
          </button>
        </form>
        <form action={rotateAction}>
          <button
            className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
            disabled={rotating}
            type="submit"
          >
            Rotate
          </button>
        </form>
      </div>
      {rotateState.secret ? (
        <p className="text-sm text-amber-900">
          Secret rotated. Update your receiver with the new value.
        </p>
      ) : null}
      {revealState.error || rotateState.error ? (
        <p className="text-sm text-red-700" role="alert">
          {revealState.error ?? rotateState.error}
        </p>
      ) : null}
    </div>
  );
}
