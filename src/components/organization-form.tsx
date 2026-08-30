"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { FormSubmit } from "./form-submit";

export function OrganizationForm({ action, defaultName, submitLabel }: { action: (state: FormState, formData: FormData) => Promise<FormState>; defaultName?: string; submitLabel: string }) {
  const [state, formAction] = useActionState(action, {});
  return <form action={formAction} className="mt-6 max-w-xl space-y-4"><label className="block text-sm font-semibold">Organisatienaam<input className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-normal" defaultValue={defaultName} maxLength={120} minLength={2} name="name" required /></label>{state.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{state.error}</p>}<div className="max-w-xs"><FormSubmit>{submitLabel}</FormSubmit></div></form>;
}
