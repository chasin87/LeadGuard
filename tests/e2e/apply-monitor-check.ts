import { config } from "dotenv";
import { executeMonitorJob } from "@/server/monitoring/runner";
import { disconnectMonitorLocks } from "@/server/monitoring/runner";

if (!process.env.DATABASE_URL) {
  config({ path: process.env.E2E_ENV_FILE ?? ".env" });
}

const publicIp = "93.184.216.34";

async function main() {
  const monitorId = process.argv[2];
  const mode = process.argv[3] ?? "FAILURE";
  if (!monitorId) {
    throw new Error(
      "Usage: apply-monitor-check.ts <monitorId> <FAILURE|SUCCESS>",
    );
  }

  await executeMonitorJob(monitorId, {
    resolver: async () => [publicIp],
    transport: async () => ({
      statusCode: mode === "SUCCESS" ? 200 : 500,
      headers: {},
    }),
  });
  await disconnectMonitorLocks();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
