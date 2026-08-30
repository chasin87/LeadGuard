"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { FormSubmit } from "./form-submit";

type AuthFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  mode: "login" | "register";
};

export function AuthForm({ action, mode }: AuthFormProps) {
  const [state, formAction] = useActionState(action, {});
  const register = mode === "register";
  return (
    <form action={formAction} className="mt-7 space-y-4">
      {register && <label className="block text-sm font-semibold">Naam<input autoComplete="name" className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-normal" maxLength={120} name="name" required /></label>}
      <label className="block text-sm font-semibold">E-mailadres<input autoCapitalize="none" autoComplete="email" className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-normal" maxLength={320} name="email" required type="email" /></label>
      <label className="block text-sm font-semibold">Wachtwoord<input autoComplete={register ? "new-password" : "current-password"} className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-normal" maxLength={128} minLength={register ? 12 : 1} name="password" required type="password" /></label>
      {register && <label className="block text-sm font-semibold">Bedrijfsnaam<input autoComplete="organization" className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-normal" maxLength={120} name="organizationName" required /></label>}
      {state.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{state.error}</p>}
      <FormSubmit>{register ? "Account en organisatie maken" : "Inloggen"}</FormSubmit>
      <p className="text-center text-sm text-[var(--muted)]">{register ? "Heb je al een account?" : "Nog geen account?"} <Link className="font-semibold text-[#235347] hover:underline" href={register ? "/login" : "/register"}>{register ? "Inloggen" : "Registreren"}</Link></p>
    </form>
  );
}
