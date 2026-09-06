import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata = { title: "Wachtwoord vergeten" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Wachtwoord vergeten"
      description="We sturen een herstel-link als dit e-mailadres een account heeft."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
