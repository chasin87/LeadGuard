"use client";

export default function PlatformAdminError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <section
      className="rounded-2xl border border-[var(--border)] bg-white p-6"
      role="alert"
    >
      <h1 className="text-xl font-bold">Unable to load this page</h1>
      <p className="mt-2 text-[var(--muted)]">
        Reference: {error.digest ?? "unavailable"}
      </p>
    </section>
  );
}
