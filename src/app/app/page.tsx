import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listUserMemberships,
  resolvePostLoginPath,
} from "@/server/auth/service";
import { requireUser } from "@/server/authorization/session";

export const metadata = { title: "Organisaties" };

export default async function OrganizationSelectorPage() {
  const user = await requireUser();
  const path = await resolvePostLoginPath(user.id);
  if (path !== "/app") {
    redirect(path);
  }

  const memberships = await listUserMemberships(user.id);

  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-3xl font-bold">Kies een organisatie</h1>
      <p className="mt-2 text-[var(--muted)]">
        Je bent lid van meerdere organisaties. Kies waar je verder wilt werken.
      </p>
      <ul className="mt-8 space-y-3">
        {memberships.map((membership) => (
          <li key={membership.organization.id}>
            <Link
              className="block rounded-2xl border border-[var(--border)] bg-white px-5 py-4 hover:bg-slate-50"
              href={`/app/${membership.organization.slug}/dashboard`}
            >
              <span className="font-semibold">
                {membership.organization.name}
              </span>
              <span className="mt-1 block text-sm text-[var(--muted)]">
                {membership.role}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        className="mt-6 inline-flex font-semibold text-[#19d0a2] hover:underline"
        href="/app/organizations/new"
      >
        + Nieuwe organisatie
      </Link>
    </main>
  );
}
