import { Logo } from "@/components/logo";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm">
        <Logo />
        <h1 className="mt-9 text-2xl font-bold">{title}</h1>
        <p className="mt-2 leading-6 text-[var(--muted)]">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </main>
  );
}
