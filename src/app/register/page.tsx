import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { registerAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";

export const metadata = { title: "Registreren" };

export default async function RegisterPage() {
  if (await auth()) redirect("/onboarding");
  return <main className="grid min-h-screen place-items-center px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm"><Logo /><h1 className="mt-9 text-2xl font-bold">Start met LeadGuard</h1><p className="mt-2 leading-6 text-[var(--muted)]">Maak je account en eerste organisatie. Je wordt automatisch eigenaar.</p><AuthForm action={registerAction} mode="register" /></section></main>;
}
