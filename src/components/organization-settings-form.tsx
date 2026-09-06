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
  defaultRevenueCurrencyCode,
  role,
  canEdit,
}: {
  organizationSlug: string;
  name: string;
  slug: string;
  defaultRevenueCurrencyCode: string | null;
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
      <label className="block text-sm font-semibold">
        Default revenue currency
        <input
          className={inputClassName.replace(
            "bg-slate-50",
            canEdit ? "bg-white" : "bg-slate-50",
          )}
          type="text"
          name="defaultRevenueCurrencyCode"
          defaultValue={defaultRevenueCurrencyCode ?? ""}
          maxLength={3}
          placeholder="EUR"
          readOnly={!canEdit}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        Prefills the manual Won-revenue form. Each stored amount keeps its own
        currency. Leave empty for no default — LeadGuard does not assume EUR.
      </p>
      {state.fieldErrors?.defaultRevenueCurrencyCode ? (
        <p className="text-sm text-red-700">
          {state.fieldErrors.defaultRevenueCurrencyCode[0]}
        </p>
      ) : null}
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
