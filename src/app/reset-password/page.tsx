import { AuthCard } from "@/components/auth-card";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata = { title: "Nieuw wachtwoord" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthCard
      title="Nieuw wachtwoord"
      description="Kies een nieuw wachtwoord voor je LeadGuard-account."
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-red-700">
          Deze herstel-link mist een geldige code. Vraag een nieuwe aan.
        </p>
      )}
    </AuthCard>
  );
}
