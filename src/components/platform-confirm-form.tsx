"use client";

import { useActionState, useState } from "react";
import type { PlatformActionState } from "@/server/platform-admin/actions";

export function PlatformConfirmForm({
  action,
  confirmLabel,
  confirmValue,
  hidden,
  fields,
  submitLabel,
}: {
  action: (
    state: PlatformActionState,
    formData: FormData,
  ) => Promise<PlatformActionState>;
  confirmLabel: string;
  confirmValue: string;
  hidden: Record<string, string>;
  fields: React.ReactNode;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === confirmValue;
  return (
    <form
      action={formAction}
      className="mt-3 space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields}
      <label className="block text-sm font-semibold">
        {confirmLabel}
        <input
          className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
      </label>
      {state.error ? (
        <p className="text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p
          className="text-sm text-[#193f36]"
          data-testid="platform-action-message"
        >
          {state.message}
        </p>
      ) : null}
      <button
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        disabled={!matches || pending}
        type="submit"
      >
        {submitLabel}
      </button>
    </form>
  );
}
