"use client";

import { useActionState } from "react";
import {
  uploadOutcomeImportAction,
  type OutcomeFormState,
} from "@/server/outcomes/actions";

export function OutcomeImportUploadForm({
  organizationSlug,
  integrations,
}: {
  organizationSlug: string;
  integrations: Array<{ id: string; name: string }>;
}) {
  const action = uploadOutcomeImportAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as OutcomeFormState,
  );
  return (
    <section className="max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Upload file</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        CSV (UTF-8) or XLSX. Formula and macro cells are rejected. Unmapped
        columns are not stored.
      </p>
      <form action={formAction} className="mt-4 space-y-3 text-sm">
        <label className="block font-semibold">
          Integration
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            name="integrationId"
            required
          >
            {integrations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block font-semibold">
          File
          <input
            className="mt-1 block"
            name="file"
            type="file"
            accept=".csv,.xlsx"
            required
          />
        </label>
        {state.error ? (
          <p className="font-semibold text-red-700">{state.error}</p>
        ) : null}
        {state.integrationId ? (
          <p>
            Uploaded.{" "}
            <a
              className="font-semibold text-[#19d0a2]"
              href={`/app/${organizationSlug}/integrations/outcomes/imports/${state.integrationId}`}
            >
              Map columns
            </a>
          </p>
        ) : null}
        <button
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
          disabled={pending || integrations.length === 0}
          type="submit"
        >
          Upload
        </button>
      </form>
    </section>
  );
}
