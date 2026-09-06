import { DomainError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import type { PlatformActor } from "@/server/platform-admin/access";
import { countActiveSuperAdmins } from "@/server/platform-admin/access";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import { boundReason } from "@/server/platform-admin/constants";
import { assertPlatformActor } from "@/server/platform-admin/guard";

export async function disablePlatformUser(input: {
  userId: string;
  reason: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:users:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  if (input.userId === input.actor.userId) {
    const remaining = await countActiveSuperAdmins(input.userId);
    const access = await database.platformAccess.findUnique({
      where: { userId: input.userId },
    });
    if (access?.role === "SUPER_ADMIN" && remaining === 0) {
      throw new DomainError("Cannot disable the last active SUPER_ADMIN.");
    }
  }
  const user = await database.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new DomainError("User was not found.");
  if (user.status === "DISABLED") return;
  const access = await database.platformAccess.findUnique({
    where: { userId: input.userId },
  });
  if (access?.role === "SUPER_ADMIN" && access.status === "ACTIVE") {
    const remaining = await countActiveSuperAdmins(input.userId);
    if (remaining === 0) {
      throw new DomainError("Cannot disable the last active SUPER_ADMIN.");
    }
  }
  await database.user.update({
    where: { id: input.userId },
    data: { status: "DISABLED", sessionInvalidatedAt: new Date() },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "USER_DISABLED",
    targetType: "User",
    targetId: input.userId,
    reason,
    metadata: { email: user.email },
  });
}

export async function reactivatePlatformUser(input: {
  userId: string;
  reason: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:users:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  const user = await database.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new DomainError("User was not found.");
  await database.user.update({
    where: { id: input.userId },
    data: { status: "ACTIVE" },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "USER_REACTIVATED",
    targetType: "User",
    targetId: input.userId,
    reason,
    metadata: { email: user.email },
  });
}
