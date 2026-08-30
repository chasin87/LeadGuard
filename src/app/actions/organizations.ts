"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOrganizationSchema, updateOrganizationSchema } from "@/features/organizations/schemas";
import { requireOrganizationPermission, requireUser } from "@/server/authorization";
import { createOrganizationForUser, updateOrganizationNameForUser } from "@/server/organizations/service";
import type { FormState } from "./auth";

export async function createOrganizationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const input = createOrganizationSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message };
  const user = await requireUser();
  let organization: Awaited<ReturnType<typeof createOrganizationForUser>>;
  try {
    organization = await createOrganizationForUser(user.id, input.data);
  } catch {
    return { error: "De organisatie kon niet worden aangemaakt." };
  }
  redirect(`/app/${organization.slug}/dashboard`);
}

export async function updateOrganizationAction(organizationSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const input = updateOrganizationSchema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message };
  const { organization, user } = await requireOrganizationPermission(organizationSlug, "organization:update");
  await updateOrganizationNameForUser(user.id, organizationSlug, input.data);
  revalidatePath(`/app/${organization.slug}/settings`);
  return {};
}
