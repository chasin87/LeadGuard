import { z } from "zod";

export const websiteNameSchema = z
  .string()
  .trim()
  .min(2, "Website name must be at least 2 characters.")
  .max(80, "Website name may be at most 80 characters.");

export const websiteUrlInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a valid public website URL.")
  .max(2048, "Enter a valid public website URL.");

export const websiteStatusSchema = z.enum(["ACTIVE", "DISABLED"]);

export const createWebsiteSchema = z.object({
  name: websiteNameSchema,
  url: websiteUrlInputSchema,
});

export const updateWebsiteSchema = z.object({
  name: websiteNameSchema,
  url: websiteUrlInputSchema,
  status: websiteStatusSchema,
});

export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;
export type UpdateWebsiteInput = z.infer<typeof updateWebsiteSchema>;
