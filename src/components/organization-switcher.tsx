import Link from "next/link";
import type { OrganizationRole } from "@/generated/prisma/enums";

export function OrganizationSwitcher({
  current,
  memberships,
}: {
  current: { name: string; slug: string; role: OrganizationRole };
  memberships: Array<{ name: string; slug: string; role: OrganizationRole }>;
}) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-[var(--border)] bg-slate-50 px-3 py-2">
        <span>
          <span className="block text-sm font-semibold">{current.name}</span>
          <span className="text-xs font-medium tracking-wide text-[var(--muted)]">
            {current.role}
          </span>
        </span>
        <span className="text-[var(--muted)]" aria-hidden="true">
          ▼
        </span>
      </summary>
      <div className="absolute z-20 mt-2 w-full min-w-[16rem] rounded-xl border border-[var(--border)] bg-white p-2 shadow-lg">
        <p className="px-2 py-1 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
          Jouw organisaties
        </p>
        {memberships.map((membership) => (
          <Link
            className={`block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${
              membership.slug === current.slug
                ? "bg-[var(--brand-light)] font-semibold"
                : ""
            }`}
            href={`/app/${membership.slug}/dashboard`}
            key={membership.slug}
          >
            <span className="block">{membership.name}</span>
            <span className="text-xs text-[var(--muted)]">
              {membership.role}
            </span>
          </Link>
        ))}
        <div className="my-2 border-t border-[var(--border)]" />
        <Link
          className="block rounded-lg px-3 py-2 text-sm font-semibold text-[#19d0a2] hover:bg-slate-50"
          href="/app/organizations/new"
        >
          + Nieuwe organisatie
        </Link>
      </div>
    </details>
  );
}
