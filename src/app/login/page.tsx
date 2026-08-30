import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Inloggen" };

export default function LoginPage() {
  return (
    <AuthCard
      title="Inloggen"
      description="Log in met je e-mailadres en wachtwoord om je organisaties te beheren."
    >
      <LoginForm />
    </AuthCard>
  );
}
