"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeMemberRoleSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
} from "@/lib/validation/organization";
import { DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import {
  changeOrganizationMemberRole,
  createOrganizationWithOwner,
  updateOrganizationName,
} from "@/server/organizations/service";

export type OrganizationFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function createOrganizationAction(
  _previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  const user = await requireUser();
  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const organization = await createOrganizationWithOwner({
      userId: user.id,
      name: parsed.data.name,
    });
    redirect(`/app/${organization.slug}/dashboard`);
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function updateOrganizationAction(
  organizationSlug: string,
  _previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  const user = await requireUser();
  const parsed = updateOrganizationSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateOrganizationName(user.id, organizationSlug, parsed.data.name);
    revalidatePath(`/app/${organizationSlug}/settings`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Opslaan is mislukt." };
  }
}

export async function changeMemberRoleAction(
  organizationSlug: string,
  formData: FormData,
): Promise<OrganizationFormState> {
  const user = await requireUser();
  const parsed = changeMemberRoleSchema.safeParse({
    memberId: formData.get("memberId"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: "Ongeldige rolwijziging." };
  }

  try {
    await changeOrganizationMemberRole({
      actorUserId: user.id,
      organizationSlug,
      memberId: parsed.data.memberId,
      role: parsed.data.role,
    });
    revalidatePath(`/app/${organizationSlug}/settings/members`);
    return {};
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Deze rolwijziging is niet toegestaan." };
  }
}
