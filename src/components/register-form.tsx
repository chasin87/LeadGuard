"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type AuthFormState } from "@/server/auth/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function RegisterForm() {
  const [state, action, pending] = useActionState(
    registerAction,
    {} as AuthFormState,
  );

  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-semibold">
        Naam
        <input
          className={inputClassName}
          type="text"
          name="name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={80}
        />
      </label>
      {state.fieldErrors?.name ? (
        <p className="text-sm text-red-700">{state.fieldErrors.name[0]}</p>
      ) : null}
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
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        Minimaal 10 tekens, met minstens één letter en één cijfer.
      </p>
      {state.fieldErrors?.password ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {state.fieldErrors.password.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
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
        {pending ? "Account aanmaken…" : "Account aanmaken"}
      </button>
      <p className="text-center text-sm text-[var(--muted)]">
        Al een account?{" "}
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href="/login"
        >
          Inloggen
        </Link>
      </p>
    </form>
  );
}
