"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  forgotPasswordAction,
  type AuthFormState,
} from "@/server/auth/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    forgotPasswordAction,
    {} as AuthFormState,
  );

  if (state.success) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
        Als dit e-mailadres een LeadGuard-account heeft, sturen we een
        herstel-link. Controleer je inbox.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-semibold">
        E-mailadres
        <input
          className={inputClassName}
          type="email"
          name="email"
          autoComplete="email"
          required
        />
      </label>
      {state.fieldErrors?.email ? (
        <p className="text-sm text-red-700">{state.fieldErrors.email[0]}</p>
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
        {pending ? "Bezig…" : "Stuur herstel-link"}
      </button>
      <p className="text-center text-sm text-[var(--muted)]">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href="/login"
        >
          Terug naar inloggen
        </Link>
      </p>
    </form>
  );
}
