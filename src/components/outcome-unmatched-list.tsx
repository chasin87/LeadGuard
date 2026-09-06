"use client";

import { useActionState } from "react";
import {
  ignoreOutcomeEventAction,
  linkOutcomeEventAction,
  type OutcomeFormState,
} from "@/server/outcomes/actions";

export function OutcomeUnmatchedList({
  organizationSlug,
  events,
  websites,
  canManage,
}: {
  organizationSlug: string;
  events: Array<{
    id: string;
    sourceSystem: string;
    sourceRecordId: string | null;
    externalLeadId: string | null;
    status: string | null;
    hasRevenue: boolean;
    currency: string | null;
    receivedAtLabel: string;
    integrationName: string;
  }>;
  websites: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No unmatched events.</p>;
  }
  return (
    <div className="space-y-4">
      {events.map((event) => (
        <UnmatchedCard
          key={event.id}
          organizationSlug={organizationSlug}
          event={event}
          websites={websites}
          canManage={canManage}
        />
      ))}
    </div>
  );
}

function UnmatchedCard({
  organizationSlug,
  event,
  websites,
  canManage,
}: {
  organizationSlug: string;
  event: {
    id: string;
    sourceSystem: string;
    sourceRecordId: string | null;
    externalLeadId: string | null;
    status: string | null;
    hasRevenue: boolean;
    currency: string | null;
    receivedAtLabel: string;
    integrationName: string;
  };
  websites: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const link = linkOutcomeEventAction.bind(null, organizationSlug, event.id);
  const [state, formAction, pending] = useActionState(
    link,
    {} as OutcomeFormState,
  );
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <p className="font-semibold">
        {event.integrationName} · {event.status ?? "unknown"}
      </p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Source {event.sourceSystem} · record {event.sourceRecordId ?? "—"} ·
        external ID {event.externalLeadId ?? "—"} · received{" "}
        {event.receivedAtLabel}
        {event.hasRevenue ? ` · revenue ${event.currency ?? ""}` : ""}
      </p>
      {canManage ? (
        <form
          action={formAction}
          className="mt-4 grid gap-2 text-sm sm:grid-cols-2"
        >
          <input
            className="rounded-lg border border-[var(--border)] px-3 py-2"
            name="publicLeadId"
            placeholder="publicLeadId"
          />
          <input
            className="rounded-lg border border-[var(--border)] px-3 py-2"
            name="externalLeadId"
            placeholder="externalLeadId"
            defaultValue={event.externalLeadId ?? ""}
          />
          <select
            className="rounded-lg border border-[var(--border)] px-3 py-2"
            name="websiteId"
          >
            <option value="">Any allowed website</option>
            {websites.map((website) => (
              <option key={website.id} value={website.id}>
                {website.name}
              </option>
            ))}
          </select>
          {state.error ? (
            <p className="font-semibold text-red-700 sm:col-span-2">
              {state.error}
            </p>
          ) : null}
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
            disabled={pending}
            type="submit"
          >
            Link and apply
          </button>
          <button
            className="rounded-lg border border-[var(--border)] px-4 py-2 font-semibold"
            formAction={async () => {
              await ignoreOutcomeEventAction(organizationSlug, event.id);
            }}
            type="submit"
          >
            Ignore
          </button>
        </form>
      ) : null}
    </article>
  );
}
