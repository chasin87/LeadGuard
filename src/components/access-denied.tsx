import Link from "next/link";

export function AccessDenied() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-8"
        role="alert"
      >
        <p className="text-sm font-semibold text-red-800">403</p>
        <h1 className="mt-2 text-2xl font-bold">Geen toegang</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Je hebt geen lidmaatschap voor deze organisatie. De gevraagde gegevens
          worden niet getoond.
        </p>
        <Link
          className="mt-6 inline-flex rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
          href="/app"
        >
          Terug naar jouw organisaties
        </Link>
      </section>
    </main>
  );
}
