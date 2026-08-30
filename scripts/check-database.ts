import { database } from "../src/server/database";

async function checkDatabase() {
  try {
    await database.$queryRaw`SELECT 1`;
    console.info("Database connection successful.");
  } finally {
    await database.$disconnect();
  }
}

checkDatabase().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
