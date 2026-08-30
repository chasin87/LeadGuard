import { AuthCard } from "@/components/auth-card";
import { RegisterForm } from "@/components/register-form";

export const metadata = { title: "Registreren" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Account maken"
      description="Stap 1 van 2: maak je LeadGuard-account. Daarna voeg je je organisatie toe."
    >
      <RegisterForm />
    </AuthCard>
  );
}
