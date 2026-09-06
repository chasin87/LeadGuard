import { z } from "zod";

export const organizationRoles = ["OWNER", "ADMIN", "MEMBER"] as const;

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Bedrijfsnaam moet minimaal 2 tekens bevatten.")
  .max(80, "Bedrijfsnaam mag maximaal 80 tekens bevatten.");

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
});

export const updateOrganizationSchema = z.object({
  name: organizationNameSchema,
  defaultRevenueCurrencyCode: z.string().trim().max(8).optional(),
});

export const organizationRoleSchema = z.enum(organizationRoles);

export const changeMemberRoleSchema = z.object({
  memberId: z.string().min(1).max(64),
  role: organizationRoleSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
