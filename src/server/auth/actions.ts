"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { signIn, signOut } from "@/server/auth";
import {
  clientRateLimitIdentity,
  consumeRateLimit,
} from "@/server/auth/rate-limit";
import {
  createUserAccount,
  resolvePostLoginPathByEmail,
} from "@/server/auth/service";
import { DomainError } from "@/server/authorization/errors";
import {
  completePasswordReset,
  requestPasswordReset,
} from "@/server/auth/password-reset";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
};

async function rateLimitKey(kind: string, extra = ""): Promise<string> {
  const identity = clientRateLimitIdentity(await headers());
  return extra ? `${kind}:${identity}:${extra}` : `${kind}:${identity}`;
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

export async function forgotPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = consumeRateLimit(await rateLimitKey("forgot-password"), 10);
  if (!limit.ok) {
    return { error: "Te veel pogingen. Wacht even en probeer het opnieuw." };
  }
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await requestPasswordReset(parsed.data.email);
  } catch {
    return {
      error:
        "Het herstelverzoek kon niet worden verstuurd. Probeer het later opnieuw.",
    };
  }
  return { success: true };
}

export async function resetPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = consumeRateLimit(await rateLimitKey("reset-password"), 10);
  if (!limit.ok) {
    return { error: "Te veel pogingen. Wacht even en probeer het opnieuw." };
  }
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await completePasswordReset(parsed.data);
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return {
      error: "Wachtwoord resetten is mislukt. Probeer het later opnieuw.",
    };
  }
  return { success: true };
}
