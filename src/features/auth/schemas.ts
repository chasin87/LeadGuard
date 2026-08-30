import { z } from "zod";

export const emailSchema = z.string().trim().email().max(320).transform((email) => email.toLowerCase());
export const passwordSchema = z.string().min(12, "Gebruik minimaal 12 tekens.").max(128, "Gebruik maximaal 128 tekens.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const registrationSchema = z.object({
  name: z.string().trim().min(2, "Vul je naam in.").max(120),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2, "Vul je bedrijfsnaam in.").max(120),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
