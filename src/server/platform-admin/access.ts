import type { PlatformRole } from "@/generated/prisma/enums";
import { database } from "@/server/database";

export type PlatformActor = {
  userId: string;
  email: string;
  name: string;
  role: PlatformRole;
};

export async function loadPlatformAccess(
  userId: string,
): Promise<PlatformActor | null> {
  const row = await database.platformAccess.findUnique({
    where: { userId },
    include: { user: { select: { email: true, name: true, status: true } } },
  });
  if (!row || row.status !== "ACTIVE") return null;
  if (row.user.status !== "ACTIVE") return null;
  return {
    userId: row.userId,
    email: row.user.email,
    name: row.user.name,
    role: row.role,
  };
}

export async function countActiveSuperAdmins(
  excludeUserId?: string,
): Promise<number> {
  return database.platformAccess.count({
    where: {
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
  });
}
