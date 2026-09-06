import type { PlatformRole } from "@/generated/prisma/enums";
import { DomainError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import { normalizeEmail } from "@/server/auth/email";
import type { PlatformActor } from "@/server/platform-admin/access";
import { countActiveSuperAdmins } from "@/server/platform-admin/access";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import { boundReason } from "@/server/platform-admin/constants";
import { assertPlatformActor } from "@/server/platform-admin/guard";

export class PlatformBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformBootstrapError";
  }
}

export async function grantPlatformAccess(input: {
  email: string;
  role: PlatformRole;
  confirm: boolean;
  reason: string;
  actor: PlatformActor | null;
}): Promise<{ userId: string; role: PlatformRole; created: boolean }> {
  if (input.actor) {
    const { assertPlatformActor } =
      await import("@/server/platform-admin/guard");
    assertPlatformActor(input.actor, "platform:roles:manage");
  }
  if (!input.confirm) {
    throw new PlatformBootstrapError(
      "Refusing to grant platform access without explicit --confirm.",
    );
  }
  const reason = boundReason(input.reason);
  if (reason.length < 3) {
    throw new PlatformBootstrapError("A reason is required.");
  }
  const email = normalizeEmail(input.email);
  const user = await database.user.findUnique({
    where: { email },
    select: { id: true, email: true, status: true },
  });
  if (!user) {
    throw new PlatformBootstrapError("Unknown user. Create the account first.");
  }
  const existing = await database.platformAccess.findUnique({
    where: { userId: user.id },
  });
  if (existing?.role === input.role && existing.status === "ACTIVE") {
    await recordPlatformAudit({
      actor: input.actor,
      action: "PLATFORM_ROLE_GRANTED",
      targetType: "User",
      targetId: user.id,
      reason: `${reason} (idempotent)`,
      metadata: { role: input.role, email: user.email },
    });
    return { userId: user.id, role: input.role, created: false };
  }
  if (
    existing?.role === "SUPER_ADMIN" &&
    existing.status === "ACTIVE" &&
    input.role !== "SUPER_ADMIN"
  ) {
    const remaining = await countActiveSuperAdmins(user.id);
    if (remaining === 0) {
      throw new DomainError("Cannot demote the last active SUPER_ADMIN.");
    }
  }
  const row = await database.platformAccess.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: input.role,
      status: "ACTIVE",
      createdByUserId: input.actor?.userId ?? null,
    },
    update: {
      role: input.role,
      status: "ACTIVE",
    },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "PLATFORM_ROLE_GRANTED",
    targetType: "User",
    targetId: user.id,
    reason,
    metadata: {
      role: input.role,
      email: user.email,
      previousRole: existing?.role ?? null,
    },
  });
  return { userId: row.userId, role: row.role, created: !existing };
}

export async function revokePlatformAccess(input: {
  userId: string;
  reason: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:roles:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) {
    throw new DomainError("A reason is required.");
  }
  const existing = await database.platformAccess.findUnique({
    where: { userId: input.userId },
  });
  if (!existing || existing.status !== "ACTIVE") {
    throw new DomainError("This user does not have platform access.");
  }
  if (existing.role === "SUPER_ADMIN") {
    const remaining = await countActiveSuperAdmins(input.userId);
    if (remaining === 0) {
      throw new DomainError("Cannot revoke the last active SUPER_ADMIN.");
    }
  }
  if (input.actor.userId === input.userId && existing.role === "SUPER_ADMIN") {
    const remaining = await countActiveSuperAdmins(input.userId);
    if (remaining === 0) {
      throw new DomainError("Cannot revoke your own last SUPER_ADMIN access.");
    }
  }
  await database.platformAccess.update({
    where: { userId: input.userId },
    data: { status: "DISABLED" },
  });
  await database.user.update({
    where: { id: input.userId },
    data: { sessionInvalidatedAt: new Date() },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "PLATFORM_ROLE_REVOKED",
    targetType: "User",
    targetId: input.userId,
    reason,
    metadata: { previousRole: existing.role },
  });
}
