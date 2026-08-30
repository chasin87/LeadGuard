"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <section className="max-w-md rounded-2xl border border-[var(--border)] bg-white p-8">
        <h1 className="text-2xl font-bold">Er ging iets mis</h1>
        <p className="mt-2 text-[var(--muted)]">
          De actie is gestopt. Probeer het opnieuw of ga terug naar het
          dashboard.
        </p>
        <button
          className="mt-6 rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white"
          onClick={reset}
          type="button"
        >
          Opnieuw proberen
        </button>
      </section>
    </main>
  );
}
