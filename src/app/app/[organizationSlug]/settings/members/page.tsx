import { notFound } from "next/navigation";
import { database } from "@/server/database";
import { isOrganizationAccessDenied, requireOrganizationPermission } from "@/server/authorization";

export const metadata = { title: "Leden" };

export default async function MembersPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  try {
    const { organization } = await requireOrganizationPermission(organizationSlug, "members:view");
    const members = await database.organizationMember.findMany({ where: { organizationId: organization.id }, select: { id: true, role: true, createdAt: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } });
    return <><p className="text-sm font-semibold text-[#235347]">Instellingen</p><h1 className="mt-1 text-3xl font-bold">Leden</h1><section className="mt-7 overflow-hidden rounded-2xl border border-[var(--border)] bg-white"><div className="border-b border-[var(--border)] p-5"><p className="text-sm text-[var(--muted)]">Uitnodigingen volgen in een latere fase; er is bewust nog geen niet-werkende invite-actie.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[var(--muted)]"><tr><th className="p-4">Naam</th><th className="p-4">E-mail</th><th className="p-4">Rol</th><th className="p-4">Lid sinds</th></tr></thead><tbody>{members.map((member) => <tr className="border-t border-[var(--border)]" key={member.id}><td className="p-4 font-semibold">{member.user.name}</td><td className="p-4">{member.user.email}</td><td className="p-4">{member.role}</td><td className="p-4">{new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" }).format(member.createdAt)}</td></tr>)}</tbody></table></div></section></>;
  } catch (error) {
    if (isOrganizationAccessDenied(error)) notFound();
    throw error;
  }
}
