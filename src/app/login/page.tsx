import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Inloggen" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm">
        <Logo />
        <h1 className="mt-9 text-2xl font-bold">Inloggen</h1>
        <p className="mt-2 leading-6 text-[var(--muted)]">Authenticatie wordt veilig geïmplementeerd in fase 2. Dit scherm activeert nog geen sessie.</p>
        <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><strong>Foundation preview.</strong> Er worden nog geen inloggegevens gevraagd of opgeslagen.</div>
        <Link className="mt-7 block text-center text-sm font-semibold text-[#235347] hover:underline" href="/">Terug naar de homepage</Link>
      </section>
    </main>
  );
}
