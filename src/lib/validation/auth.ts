import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "Wachtwoord moet minimaal 10 tekens bevatten.")
  .max(128, "Wachtwoord mag maximaal 128 tekens bevatten.")
  .regex(/[A-Za-z]/, "Wachtwoord moet minstens één letter bevatten.")
  .regex(/[0-9]/, "Wachtwoord moet minstens één cijfer bevatten.");

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Naam moet minimaal 2 tekens bevatten.")
    .max(80, "Naam mag maximaal 80 tekens bevatten."),
  email: z.string().trim().pipe(z.email("Voer een geldig e-mailadres in.")),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Voer een geldig e-mailadres in.")),
  password: z.string().min(1, "Wachtwoord is verplicht.").max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().pipe(z.email("Voer een geldig e-mailadres in.")),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16, "Ongeldige herstelcode."),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
