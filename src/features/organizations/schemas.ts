import { z } from "zod";

export const organizationNameSchema = z.string().trim().min(2, "Vul minimaal 2 tekens in.").max(120);
export const organizationSlugSchema = z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const createOrganizationSchema = z.object({ name: organizationNameSchema });
export const updateOrganizationSchema = z.object({ name: organizationNameSchema });
