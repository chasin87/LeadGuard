"use client";

import { useActionState } from "react";
import {
  createOrganizationAction,
  type OrganizationFormState,
} from "@/server/organizations/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function OrganizationCreateForm({
  submitLabel = "Organisatie maken",
}: {
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState(
    createOrganizationAction,
    {} as OrganizationFormState,
  );

  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-semibold">
        Bedrijfsnaam
        <input
          className={inputClassName}
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={80}
          placeholder="Voltios Energie"
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        We maken automatisch een unieke link, bijvoorbeeld{" "}
        <code>voltios-energie</code>.
      </p>
      {state.fieldErrors?.name ? (
        <p className="text-sm text-red-700">{state.fieldErrors.name[0]}</p>
      ) : null}
      {state.error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <button
        className="w-full rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Bezig…" : submitLabel}
      </button>
    </form>
  );
}
