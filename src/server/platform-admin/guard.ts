import { AuthorizationError } from "@/server/authorization/errors";
import type { PlatformActor } from "@/server/platform-admin/access";
import {
  hasPlatformPermission,
  type PlatformPermission,
} from "@/server/platform-admin/permissions";

export function assertPlatformActor(
  actor: PlatformActor,
  permission: PlatformPermission,
) {
  if (!hasPlatformPermission(actor.role, permission)) {
    throw new AuthorizationError(
      "This platform action is not allowed for your role.",
    );
  }
}
