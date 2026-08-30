import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Dashboard" };

const cards = [
  ["Websites bewaakt", "—"], ["Actieve incidenten", "—"], ["Checks laatste 24 uur", "—"], ["Gem. responstijd", "—"],
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-white"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"><Logo /><Link className="text-sm font-semibold text-[var(--muted)]" href="/">Afmelden</Link></div></header>
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-[#235347]">Overall status</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1></div><span className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)]">Foundation preview</span></div>
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Kerncijfers">{cards.map(([label, value]) => <article className="rounded-2xl border border-[var(--border)] bg-white p-5" key={label}><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-4 text-3xl font-bold">{value}</p></article>)}</section>
        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-8"><h2 className="text-xl font-bold">Nog geen klantdata</h2><p className="mt-2 max-w-xl leading-7 text-[var(--muted)]">Organisaties, websites en echte monitorstatussen volgen vanaf fase 2 en 3. De interface toont bewust geen fictieve monitoringresultaten.</p></section>
      </div>
    </main>
  );
}
