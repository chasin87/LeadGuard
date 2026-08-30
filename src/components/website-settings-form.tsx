"use client";

import { useActionState } from "react";
import {
  updateWebsiteAction,
  type WebsiteFormState,
} from "@/server/websites/actions";
import type { WebsiteStatus } from "@/generated/prisma/enums";

const inputClassName =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm";

export function WebsiteSettingsForm({
  organizationSlug,
  websiteId,
  name,
  url,
  status,
}: {
  organizationSlug: string;
  websiteId: string;
  name: string;
  url: string;
  status: WebsiteStatus;
}) {
  const action = updateWebsiteAction.bind(null, organizationSlug, websiteId);
  const [state, formAction, pending] = useActionState(
    action,
    {} as WebsiteFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm font-semibold">
        Website name
        <input
          className={inputClassName}
          type="text"
          name="name"
          defaultValue={name}
          required
          minLength={2}
          maxLength={80}
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
          defaultValue={url}
          required
          maxLength={2048}
        />
      </label>
      {state.fieldErrors?.url ? (
        <p className="text-sm text-red-700">{state.fieldErrors.url[0]}</p>
      ) : null}
      <label className="block text-sm font-semibold">
        Status
        <select className={inputClassName} name="status" defaultValue={status}>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </label>
      <p className="text-sm text-[var(--muted)]">
        Disabled means future monitors for this website must not run. This is a
        configuration setting, not an uptime result.
      </p>
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
        {pending ? "Checking website URL…" : "Save changes"}
      </button>
    </form>
  );
}
