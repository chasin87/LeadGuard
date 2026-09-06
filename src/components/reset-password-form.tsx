"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction, type AuthFormState } from "@/server/auth/actions";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    {} as AuthFormState,
  );

  if (state.success) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
        Je wachtwoord is bijgewerkt.{" "}
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href="/login"
        >
          Inloggen
        </Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input name="token" type="hidden" value={token} />
      <label className="block text-sm font-semibold">
        Nieuw wachtwoord
        <input
          className={inputClassName}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
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
        {pending ? "Bezig…" : "Wachtwoord opslaan"}
      </button>
    </form>
  );
}
