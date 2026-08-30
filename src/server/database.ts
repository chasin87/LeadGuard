import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnvironment } from "@/lib/env";

const globalDatabase = globalThis as unknown as { database?: PrismaClient };

function createDatabaseClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: getServerEnvironment().DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}

function getDatabase(): PrismaClient {
  const existing = globalDatabase.database;
  // Next.js HMR can keep a PrismaClient created before the last generate.
  if (existing && "notificationChannel" in existing) {
    return existing;
  }
  const created = createDatabaseClient();
  if (process.env.NODE_ENV !== "production") {
    globalDatabase.database = created;
  }
  return created;
}

export const database = getDatabase();
