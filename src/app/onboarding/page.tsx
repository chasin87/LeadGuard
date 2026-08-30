import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { OrganizationCreateForm } from "@/components/organization-create-form";
import { listUserMemberships } from "@/server/auth/service";
import { requireUser } from "@/server/authorization/session";

export const metadata = { title: "Organisatie" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const memberships = await listUserMemberships(user.id);
  if (memberships[0]) {
    redirect(`/app/${memberships[0].organization.slug}/dashboard`);
  }

  return (
    <AuthCard
      title="Maak je organisatie"
      description="Stap 2 van 2: je wordt automatisch eigenaar van deze organisatie."
    >
      <OrganizationCreateForm />
    </AuthCard>
  );
}
