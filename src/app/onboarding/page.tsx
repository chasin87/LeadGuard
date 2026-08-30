import { createOrganizationAction } from "@/app/actions/organizations";
import { Logo } from "@/components/logo";
import { OrganizationForm } from "@/components/organization-form";
import { requireUser } from "@/server/authorization";

export const metadata = { title: "Nieuwe organisatie" };

export default async function OnboardingPage() {
  await requireUser();
  return <main className="grid min-h-screen place-items-center px-5 py-12"><section className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm"><Logo /><p className="mt-9 text-sm font-semibold text-[#235347]">Organisatie toevoegen</p><h1 className="mt-1 text-2xl font-bold">Welke organisatie wil je beveiligen?</h1><p className="mt-2 text-[var(--muted)]">Je wordt OWNER en kunt later leden toevoegen.</p><OrganizationForm action={createOrganizationAction} submitLabel="Organisatie maken" /></section></main>;
}
