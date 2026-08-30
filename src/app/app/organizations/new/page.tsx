import { Logo } from "@/components/logo";
import { OrganizationCreateForm } from "@/components/organization-create-form";
import { requireUser } from "@/server/authorization/session";

export const metadata = { title: "Nieuwe organisatie" };

export default async function NewOrganizationPage() {
  await requireUser();

  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <Logo href="/app" />
      <h1 className="mt-8 text-3xl font-bold">Nieuwe organisatie</h1>
      <p className="mt-2 text-[var(--muted)]">
        Jij wordt automatisch eigenaar. Daarna kun je wisselen via de
        organisatieswitcher.
      </p>
      <div className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-6">
        <OrganizationCreateForm submitLabel="Organisatie toevoegen" />
      </div>
    </main>
  );
}
