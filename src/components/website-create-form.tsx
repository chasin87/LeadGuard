"use client";

import { useActionState, useState } from "react";
import {
  createWebsiteAction,
  type WebsiteFormState,
} from "@/server/websites/actions";
import { suggestedWebsiteName } from "@/lib/urls/normalize-url";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function WebsiteCreateForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const action = createWebsiteAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(
    action,
    {} as WebsiteFormState,
  );
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm font-semibold">
        Website name
        <input
          className={inputClassName}
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(event) => {
            setNameTouched(true);
            setName(event.target.value);
          }}
        />
      </label>
      {state.fieldErrors?.name ? (
        <p className="text-sm text-red-700">{state.fieldErrors.name[0]}</p>
      ) : null}
      <label className="block text-sm font-semibold">
        Website URL
        <input
          className={inputClassName}
          type="text"
          name="url"
          required
          maxLength={2048}
          placeholder="voltiosenergie.nl"
          onBlur={(event) => {
            if (nameTouched && name.trim()) return;
            const host = event.currentTarget.value
              .trim()
              .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
              .split("/")[0]
              ?.split(":")[0];
            if (host) setName(suggestedWebsiteName(host.toLowerCase()));
          }}
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        Enter the website origin, for example <code>voltiosenergie.nl</code>.
        Specific pages are configured later as monitors.
      </p>
      {state.fieldErrors?.url ? (
        <p className="text-sm text-red-700">{state.fieldErrors.url[0]}</p>
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
        className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Checking website URL…" : "Add website"}
      </button>
    </form>
  );
}
