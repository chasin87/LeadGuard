"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { loginSchema, registrationSchema } from "@/features/auth/schemas";
import { listOrganizationsForUser, registerWithOrganization } from "@/server/organizations/service";

export type FormState = { error?: string };
const invalidCredentials = "E-mailadres of wachtwoord is onjuist.";

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  const input = loginSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: invalidCredentials };
  try {
    await signIn("credentials", { ...input.data, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { error: invalidCredentials };
    throw error;
  }
  const { database } = await import("@/server/database");
  const user = await database.user.findUnique({ where: { email: input.data.email }, select: { id: true } });
  if (!user) return { error: invalidCredentials };
  const memberships = await listOrganizationsForUser(user.id);
  redirect(memberships[0] ? `/app/${memberships[0].organization.slug}/dashboard` : "/onboarding");
}

export async function registerAction(_state: FormState, formData: FormData): Promise<FormState> {
  const input = registrationSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Controleer de ingevoerde gegevens." };
  let result: Awaited<ReturnType<typeof registerWithOrganization>>;
  try {
    result = await registerWithOrganization(input.data);
  } catch {
    return { error: "Registratie is niet gelukt. Controleer je gegevens of probeer het later opnieuw." };
  }
  try {
    await signIn("credentials", { email: input.data.email, password: input.data.password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }
  redirect(`/app/${result.organization.slug}/dashboard`);
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
