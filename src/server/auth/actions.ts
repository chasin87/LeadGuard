"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { signIn, signOut } from "@/server/auth";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import {
  createUserAccount,
  resolvePostLoginPathByEmail,
} from "@/server/auth/service";
import { DomainError } from "@/server/authorization/errors";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

async function rateLimitKey(kind: string, extra = ""): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    "unknown";
  return extra ? `${kind}:${ip}:${extra}` : `${kind}:${ip}`;
}

export async function registerAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = consumeRateLimit(await rateLimitKey("register"), 30);
  if (!limit.ok) {
    return {
      error: "Te veel pogingen. Wacht even en probeer het opnieuw.",
    };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createUserAccount(parsed.data);
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Account aanmaken is mislukt. Probeer het later opnieuw." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/onboarding",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error:
          "Account is aangemaakt, maar inloggen is mislukt. Probeer in te loggen.",
      };
    }
    throw error;
  }

  return {};
}

export async function loginAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ipLimit = consumeRateLimit(await rateLimitKey("login"), 30);
  const emailLimit = consumeRateLimit(
    `login-email:${parsed.data.email.toLowerCase()}`,
    20,
  );
  if (!ipLimit.ok || !emailLimit.ok) {
    return {
      error: "Te veel pogingen. Wacht even en probeer het opnieuw.",
    };
  }

  try {
    const destination = await resolvePostLoginPathByEmail(parsed.data.email);
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: destination,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "E-mailadres of wachtwoord is onjuist." };
    }
    throw error;
  }

  return {};
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
