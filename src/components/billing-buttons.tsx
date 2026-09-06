"use client";

import { useActionState } from "react";
import {
  refreshBillingAction,
  startCheckoutAction,
  startPortalAction,
  type BillingFormState,
} from "@/server/billing/actions";

const buttonClass =
  "rounded-xl bg-[#19d0a2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#193f36] disabled:opacity-60";

export function CheckoutButton({
  organizationSlug,
  planKey,
  label,
}: {
  organizationSlug: string;
  planKey: string;
  label: string;
}) {
  const action = startCheckoutAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    async (_prev: BillingFormState, formData: FormData) => action(formData),
    {} as BillingFormState,
  );
  return (
    <form action={formAction}>
      <input name="planKey" type="hidden" value={planKey} />
      <button className={buttonClass} disabled={pending} type="submit">
        {pending ? "Starting Checkout…" : label}
      </button>
      {state.error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function PortalButton({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction, pending] = useActionState(
    async () => startPortalAction(organizationSlug),
    {} as BillingFormState,
  );
  return (
    <form action={formAction}>
      <button className={buttonClass} disabled={pending} type="submit">
        {pending ? "Opening portal…" : "Manage billing"}
      </button>
      {state.error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function RefreshBillingButton({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction, pending] = useActionState(
    async () => refreshBillingAction(organizationSlug),
    {} as BillingFormState,
  );
  return (
    <form action={formAction}>
      <button
        className="text-sm font-semibold text-[#19d0a2] hover:underline disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Refreshing…" : "Refresh billing status"}
      </button>
      {state.error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
