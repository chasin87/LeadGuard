"use client";

import { useActionState } from "react";
import {
  retryFailedDeliveryAction,
  type NotificationFormState,
} from "@/server/notifications/actions";

export function NotificationDeliveryRetryForm({
  organizationSlug,
  incidentId,
  deliveryId,
}: {
  organizationSlug: string;
  incidentId: string;
  deliveryId: string;
}) {
  const action = retryFailedDeliveryAction.bind(
    null,
    organizationSlug,
    incidentId,
    deliveryId,
  );
  const [state, formAction, pending] = useActionState(
    action,
    {} as NotificationFormState,
  );

  return (
    <form action={formAction} className="mt-2 space-y-1">
      <button
        className="text-sm font-semibold text-[#19d0a2] hover:underline disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Retrying…" : "Retry"}
      </button>
      {state.error ? (
        <p className="text-sm text-red-700">{state.error}</p>
      ) : null}
    </form>
  );
}
