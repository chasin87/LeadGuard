import { database } from "../src/server/database";

try {
  await database.$queryRaw`SELECT 1`;
  console.info("Database connection successful.");
} finally {
  await database.$disconnect();
}
