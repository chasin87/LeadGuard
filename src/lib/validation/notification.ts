import { z } from "zod";

export const notificationChannelNameSchema = z
  .string()
  .trim()
  .min(2, "Channel name must be at least 2 characters.")
  .max(80, "Channel name may be at most 80 characters.");

export const notificationEmailSchema = z
  .string()
  .trim()
  .max(254, "Enter a valid email address.")
  .pipe(z.email("Enter a valid email address."))
  .transform((value) => value.toLowerCase());

export const notificationWebhookUrlSchema = z
  .string()
  .trim()
  .min(1, "Enter a valid public webhook URL.")
  .max(2048, "Enter a valid public webhook URL.");

export const createEmailChannelSchema = z.object({
  name: notificationChannelNameSchema,
  email: notificationEmailSchema,
  notifyOnOpened: z.boolean(),
  notifyOnResolved: z.boolean(),
});

export const createWebhookChannelSchema = z.object({
  name: notificationChannelNameSchema,
  url: notificationWebhookUrlSchema,
  notifyOnOpened: z.boolean(),
  notifyOnResolved: z.boolean(),
});

export const updateNotificationChannelSchema = z.object({
  name: notificationChannelNameSchema,
  email: notificationEmailSchema.optional(),
  url: notificationWebhookUrlSchema.optional(),
  notifyOnOpened: z.boolean(),
  notifyOnResolved: z.boolean(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export type CreateEmailChannelInput = z.infer<typeof createEmailChannelSchema>;
export type CreateWebhookChannelInput = z.infer<
  typeof createWebhookChannelSchema
>;
export type UpdateNotificationChannelInput = z.infer<
  typeof updateNotificationChannelSchema
>;
