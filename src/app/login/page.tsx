import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";
import { listOrganizationsForUser } from "@/server/organizations/service";

export const metadata = { title: "Inloggen" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user.id) {
    const memberships = await listOrganizationsForUser(session.user.id);
    redirect(memberships[0] ? `/app/${memberships[0].organization.slug}/dashboard` : "/onboarding");
  }
  return <main className="grid min-h-screen place-items-center px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm"><Logo /><h1 className="mt-9 text-2xl font-bold">Welkom terug</h1><p className="mt-2 text-[var(--muted)]">Log veilig in bij LeadGuard.</p><AuthForm action={loginAction} mode="login" /></section></main>;
}
