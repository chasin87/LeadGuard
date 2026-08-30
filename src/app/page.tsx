import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const safeguards = ["Landingspagina's", "Formulieren", "Conversieroutes"];

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <div>
          <p className="mb-5 inline-flex rounded-full bg-[var(--brand-light)] px-3 py-1 text-sm font-semibold text-[#19d0a2]">
            Continu zicht op iedere leadroute
          </p>
          <h1 className="max-w-3xl text-5xl leading-[1.08] font-bold tracking-[-0.04em] text-slate-950 md:text-6xl">
            Stop met betalen voor advertenties die nergens aankomen.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            LeadGuard controleert straks continu of je belangrijkste
            pagina&apos;s en conversieroutes bereikbaar blijven, zodat problemen
            snel zichtbaar worden.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36]"
              href="/register"
            >
              Account maken
            </Link>
            <Link
              className="rounded-xl border border-[var(--border)] bg-white px-5 py-3 font-semibold hover:bg-slate-50"
              href="/login"
            >
              Inloggen
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-[var(--border)] bg-white p-7 shadow-[0_24px_70px_rgba(28,39,55,.08)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-5">
            <div>
              <p className="text-sm text-[var(--muted)]">Platformstatus</p>
              <p className="mt-1 font-bold">Authenticatie gereed</p>
            </div>
            <span className="rounded-full bg-[var(--brand-light)] px-3 py-1 text-sm font-semibold text-[#19d0a2]">
              Fase 2
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {safeguards.map((item) => (
              <div
                className="flex items-center justify-between rounded-xl bg-slate-50 p-4"
                key={item}
              >
                <span className="font-medium">{item}</span>
                <span className="text-sm text-[var(--muted)]">
                  Volgende fasen
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
