import "server-only";

import { AuthorizationError } from "@/server/authorization/errors";
import { requireUser } from "@/server/authorization/session";
import {
  loadPlatformAccess,
  type PlatformActor,
} from "@/server/platform-admin/access";
import {
  hasPlatformPermission,
  type PlatformPermission,
} from "@/server/platform-admin/permissions";

export async function requirePlatformRole(): Promise<PlatformActor> {
  const user = await requireUser();
  const access = await loadPlatformAccess(user.id);
  if (!access) {
    throw new AuthorizationError(
      "You do not have access to the LeadGuard platform console.",
    );
  }
  return access;
}

export async function requirePlatformPermission(
  permission: PlatformPermission,
): Promise<PlatformActor> {
  const actor = await requirePlatformRole();
  if (!hasPlatformPermission(actor.role, permission)) {
    throw new AuthorizationError(
      "This platform action is not allowed for your role.",
    );
  }
  return actor;
}
