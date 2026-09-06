"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type AuthFormState } from "@/server/auth/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function LoginForm() {
  const [state, action, pending] = useActionState(
    loginAction,
    {} as AuthFormState,
  );

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
      <label className="block text-sm font-semibold">
        Wachtwoord
        <input
          className={inputClassName}
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.fieldErrors?.password ? (
        <p className="text-sm text-red-700">{state.fieldErrors.password[0]}</p>
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
        {pending ? "Bezig met inloggen…" : "Inloggen"}
      </button>
      <p className="text-center text-sm text-[var(--muted)]">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href="/forgot-password"
        >
          Wachtwoord vergeten?
        </Link>
      </p>
      <p className="text-center text-sm text-[var(--muted)]">
        Nog geen account?{" "}
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href="/register"
        >
          Registreren
        </Link>
      </p>
    </form>
  );
}
