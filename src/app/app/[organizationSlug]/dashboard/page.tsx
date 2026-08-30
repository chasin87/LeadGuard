import { requireOrganizationMembership } from "@/server/authorization";

export const metadata = { title: "Dashboard" };
const metrics = [["Websites", "0"], ["Actieve incidenten", "0"], ["Monitoringchecks", "0"]];

export default async function OrganizationDashboard({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const { organization } = await requireOrganizationMembership(organizationSlug);
  return <><p className="text-sm font-semibold text-[#235347]">{organization.name}</p><h1 className="mt-1 text-3xl font-bold">Dashboard</h1><section className="mt-7 grid gap-4 sm:grid-cols-3">{metrics.map(([label, value]) => <article className="rounded-2xl border border-[var(--border)] bg-white p-5" key={label}><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p></article>)}</section><section className="mt-7 rounded-2xl border border-[var(--border)] bg-white p-8"><h2 className="text-xl font-bold">Nog geen websites bewaakt</h2><p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">Website-monitoring wordt in de volgende setupfase geconfigureerd. Er worden nog geen controles of incidenten gesimuleerd.</p></section></>;
}
