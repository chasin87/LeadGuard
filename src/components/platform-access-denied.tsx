import Link from "next/link";

export function PlatformAccessDenied() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-8"
        role="alert"
        data-testid="platform-access-denied"
      >
        <p className="text-sm font-semibold text-red-800">403</p>
        <h1 className="mt-2 text-2xl font-bold">Access denied</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          You do not have access to this LeadGuard console.
        </p>
        <Link
          className="mt-6 inline-flex rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white"
          href="/app"
        >
          Back to app
        </Link>
      </section>
    </main>
  );
}
