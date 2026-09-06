import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import {
  getActiveSessionUser,
  type PublicUser,
} from "@/server/authorization/organization";
import { UnauthenticatedError } from "@/server/authorization/errors";

export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return getActiveSessionUser(userId);
});

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireUserOrThrow(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}
