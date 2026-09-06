import { config } from "dotenv";
import { database } from "@/server/database";
import { grantPlatformAccess } from "@/server/platform-admin/roles";
import type { PlatformRole } from "@/generated/prisma/enums";

if (!process.env.DATABASE_URL) {
  config({ path: process.env.E2E_ENV_FILE ?? ".env" });
}

async function main() {
  const email = process.argv[2];
  const role = (process.argv[3] ?? "SUPER_ADMIN") as PlatformRole;
  const heartbeat = process.argv[4];
  if (!email) {
    throw new Error(
      "Usage: apply-platform-admin.ts <email> <SUPER_ADMIN|SUPPORT> [heartbeat]",
    );
  }
  await grantPlatformAccess({
    email,
    role,
    confirm: true,
    reason: "e2e platform admin",
    actor: null,
  });
  if (heartbeat === "heartbeat") {
    await database.workerHeartbeat.upsert({
      where: {
        workerType_instanceId: { workerType: "SCHEDULER", instanceId: "e2e" },
      },
      create: {
        workerType: "SCHEDULER",
        instanceId: "e2e",
        lastSeenAt: new Date(),
        version: "e2e",
      },
      update: { lastSeenAt: new Date(), version: "e2e" },
    });
  }
  console.log(`E2E_PLATFORM_ROLE=${role}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await database.$disconnect();
  });
