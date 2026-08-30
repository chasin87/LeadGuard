import { AccessDenied } from "@/components/access-denied";
import { AuthorizationError } from "@/server/authorization/errors";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { listOrganizationMembers } from "@/server/organizations/service";
import { requireUser } from "@/server/authorization/session";
import type { OrganizationMemberView } from "@/server/organizations/service";

export const metadata = { title: "Leden" };

function formatJoinedAt(date: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function OrganizationMembersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") {
    return null;
  }

  let members: OrganizationMemberView[];
  try {
    members = await listOrganizationMembers(user.id, organizationSlug);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return <AccessDenied />;
    }
    throw error;
  }

  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Leden</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Alleen leden van deze organisatie. Uitnodigen van nieuwe gebruikers
        volgt in een latere fase; daar is nog geen werkende invite-actie voor.
      </p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-[var(--border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-slate-50">
            <tr>
              <th className="px-4 py-3 font-semibold">Naam</th>
              <th className="px-4 py-3 font-semibold">E-mail</th>
              <th className="px-4 py-3 font-semibold">Rol</th>
              <th className="px-4 py-3 font-semibold">Lid sinds</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                className="border-b border-[var(--border)] last:border-0"
                key={member.id}
              >
                <td className="px-4 py-3">{member.user.name}</td>
                <td className="px-4 py-3">{member.user.email}</td>
                <td className="px-4 py-3">{member.role}</td>
                <td className="px-4 py-3">
                  {formatJoinedAt(member.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 rounded-xl border border-dashed border-[var(--border)] bg-slate-50 p-4 text-sm text-[var(--muted)]">
        Uitnodigingen per e-mail komen later. Er is bewust geen neppe
        uitnodigingsknop.
      </p>
    </div>
  );
}
