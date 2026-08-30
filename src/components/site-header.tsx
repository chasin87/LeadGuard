import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteHeader() {
  return (
    <header className="border-b border-[var(--border)] bg-white/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-3" aria-label="Hoofdnavigatie">
          <Link
            className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-slate-50"
            href="/login"
          >
            Inloggen
          </Link>
          <Link
            className="rounded-lg bg-[#235347] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
            href="/dashboard"
          >
            Bekijk dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}
