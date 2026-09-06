"use client";

import { useActionState, useState } from "react";
import {
  createOutcomeIntegrationAction,
  type OutcomeFormState,
} from "@/server/outcomes/actions";

export function CreateOutcomeIntegrationForm({
  organizationSlug,
  websites,
}: {
  organizationSlug: string;
  websites: Array<{ id: string; name: string }>;
}) {
  const action = createOutcomeIntegrationAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as OutcomeFormState,
  );
  const [copied, setCopied] = useState(false);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Create integration</h2>
      <form action={formAction} className="mt-4 space-y-3 text-sm">
        <label className="block font-semibold">
          Name
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            name="name"
            required
          />
        </label>
        <label className="block font-semibold">
          Source system
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            name="sourceSystem"
            placeholder="custom-crm"
            required
          />
        </label>
        <label className="block font-semibold">
          Type
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            name="type"
            defaultValue="API"
          >
            <option value="API">API</option>
            <option value="WEBHOOK">Webhook</option>
            <option value="FILE_IMPORT">File import</option>
          </select>
        </label>
        <label className="block font-semibold">
          Auth
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            name="authMode"
            defaultValue="BEARER"
          >
            <option value="BEARER">Bearer</option>
            <option value="HMAC">HMAC</option>
          </select>
        </label>
        <fieldset>
          <legend className="font-semibold">Allowed websites</legend>
          <div className="mt-2 space-y-1">
            {websites.map((website) => (
              <label key={website.id} className="flex gap-2 font-normal">
                <input type="checkbox" name="websiteIds" value={website.id} />
                {website.name}
              </label>
            ))}
          </div>
        </fieldset>
        {state.error ? (
          <p className="text-sm font-semibold text-red-700">{state.error}</p>
        ) : null}
        <button
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
          disabled={pending}
          type="submit"
        >
          Create
        </button>
      </form>
      {state.credential ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-semibold">Credential (shown once)</p>
          <code
            className="mt-1 block break-all"
            data-testid="outcome-credential"
          >
            {state.credential}
          </code>
          <button
            className="mt-2 font-semibold text-[#19d0a2]"
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(state.credential ?? "");
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {state.signingSecret ? (
            <>
              <p className="mt-3 font-semibold">Signing secret (shown once)</p>
              <code className="mt-1 block break-all">
                {state.signingSecret}
              </code>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
