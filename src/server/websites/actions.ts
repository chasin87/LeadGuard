"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createWebsiteSchema,
  updateWebsiteSchema,
  websiteStatusSchema,
} from "@/lib/validation/website";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { WebsiteNotFoundError } from "@/server/security/errors";
import {
  createWebsite,
  deleteWebsite,
  setWebsiteStatus,
  updateWebsite,
} from "@/server/websites/service";

export type WebsiteFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

async function rateLimitKey(kind: string, userId: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    "unknown";
  return `${kind}:${userId}:${ip}`;
}

export async function createWebsiteAction(
  organizationSlug: string,
  _previous: WebsiteFormState,
  formData: FormData,
): Promise<WebsiteFormState> {
  const user = await requireUser();
  const limit = consumeRateLimit(
    await rateLimitKey("website-create", user.id),
    20,
  );
  if (!limit.ok) {
    return { error: "Too many attempts. Please wait and try again." };
  }

  const parsed = createWebsiteSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const website = await createWebsite({
      userId: user.id,
      organizationSlug,
      name: parsed.data.name,
      url: parsed.data.url,
    });
    redirect(`/app/${organizationSlug}/websites/${website.id}`);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage websites." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function updateWebsiteAction(
  organizationSlug: string,
  websiteId: string,
  _previous: WebsiteFormState,
  formData: FormData,
): Promise<WebsiteFormState> {
  const user = await requireUser();
  const limit = consumeRateLimit(
    await rateLimitKey("website-update", user.id),
    20,
  );
  if (!limit.ok) {
    return { error: "Too many attempts. Please wait and try again." };
  }

  const parsed = updateWebsiteSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateWebsite({
      userId: user.id,
      organizationSlug,
      websiteId,
      name: parsed.data.name,
      url: parsed.data.url,
      status: parsed.data.status,
    });
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}`);
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}/settings`);
    revalidatePath(`/app/${organizationSlug}/websites`);
    return {};
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return { error: "Website not found." };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage websites." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Saving failed." };
  }
}

export async function setWebsiteStatusAction(
  organizationSlug: string,
  websiteId: string,
  formData: FormData,
): Promise<WebsiteFormState> {
  const user = await requireUser();
  const parsed = websiteStatusSchema.safeParse(formData.get("status"));
  if (!parsed.success) {
    return { error: "Invalid website status." };
  }

  try {
    await setWebsiteStatus({
      userId: user.id,
      organizationSlug,
      websiteId,
      status: parsed.data,
    });
    revalidatePath(`/app/${organizationSlug}/websites/${websiteId}`);
    revalidatePath(`/app/${organizationSlug}/websites`);
    return {};
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return { error: "Website not found." };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage websites." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    return { error: "Updating the website status failed." };
  }
}

export async function deleteWebsiteAction(
  organizationSlug: string,
  websiteId: string,
  previous: WebsiteFormState,
  formData: FormData,
): Promise<WebsiteFormState> {
  void previous;
  void formData;
  const user = await requireUser();
  try {
    await deleteWebsite({
      userId: user.id,
      organizationSlug,
      websiteId,
    });
    revalidatePath(`/app/${organizationSlug}/websites`);
    revalidatePath(`/app/${organizationSlug}/dashboard`);
    redirect(`/app/${organizationSlug}/websites`);
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return { error: "Website not found." };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have permission to manage websites." };
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}
