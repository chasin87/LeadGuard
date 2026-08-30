"use client";

import { useActionState } from "react";
import {
  updateOrganizationAction,
  type OrganizationFormState,
} from "@/server/organizations/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-slate-50 px-3 py-2.5 text-sm";

export function OrganizationSettingsForm({
  organizationSlug,
  name,
  slug,
  role,
  canEdit,
}: {
  organizationSlug: string;
  name: string;
  slug: string;
  role: string;
  canEdit: boolean;
}) {
  const action = updateOrganizationAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as OrganizationFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm font-semibold">
        Organisatienaam
        <input
          className={inputClassName.replace(
            "bg-slate-50",
            canEdit ? "bg-white" : "bg-slate-50",
          )}
          type="text"
          name="name"
          defaultValue={name}
          required
          minLength={2}
          maxLength={80}
          readOnly={!canEdit}
        />
      </label>
      <label className="block text-sm font-semibold">
        Slug
        <input
          className={inputClassName}
          type="text"
          name="slug"
          defaultValue={slug}
          readOnly
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        De slug is in deze fase vast, zodat bestaande links niet breken.
      </p>
      <p className="text-sm">
        Jouw rol: <strong>{role}</strong>
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
      {canEdit ? (
        <button
          className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Opslaan…" : "Wijzigingen opslaan"}
        </button>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Alleen eigenaren kunnen de organisatienaam wijzigen.
        </p>
      )}
    </form>
  );
}
